// ==UserScript==
// @name            PT种子认领
// @name:zh-CN      PT种子认领
// @namespace       https://github.com/Banxiaxiala/PT_Seed_Claim
// @version         0.2.0
// @description     在用户详情页一键认领全部当前做种种子（自动展开折叠列表、自动翻页、可视化进度、已认领去重跳过）
// @description:en  One-click claim all seeding torrents on user details page (auto-expand list, progress UI, skip already-claimed)
// @author          Banxiaxiala
// @match           https://kamept.com/userdetails.php?id=*
// @match           https://www.nicept.net/userdetails.php?id=*
// @match           https://ptfans.cc/userdetails.php?id=*
// @grant           unsafeWindow
// @run-at          document-end
// @license         MIT
// ==/UserScript==

/**
 * PT种子认领
 * 改自"老师一键认领"(原 nicept 脚本)。
 * 在 PT 站用户详情页的"当前做种"行插入"一键认领"按钮，
 * 自动收集所有未认领的做种种子(支持分页翻页、折叠列表自动展开)，
 * 通过 ajax.php 逐个发起 addClaim 请求。
 *
 * 适配站点(均使用 addClaim 机制)：
 *   - KamePT   : 做种列表内联在详情页，分页(getusertorrentlistajax.php?page=N&userid=UID&type=seeding, 100/页)
 *   - NicePT   : 做种列表折叠在 #ka1，展开时经 getusertorrentlistajax.php?userid=N&type=seeding 一次加载全部
 *   - PTFans   : 同上(折叠、无分页)
 * 备注：PTT(pttime.org) 为 9kg 站点，无 addClaim 认领功能，未适配。
 */
(function () {
  'use strict';

  const SITE = location.origin;
  const HOST = location.hostname;
  const CLAIM_INTERVAL = 500;              // 每个种子请求间隔(ms)，防止短时间多次点击被处理
  const FETCH_INTERVAL = 300;              // 抓取分页间隔(ms)
  const EXPAND_WAIT = 2000;                // 展开折叠列表后等待渲染(ms)
  const USERID = (location.search.match(/[?&]id=(\d+)/) || [])[1] || '';
  const STORE_KEY = 'PT_CLAIMED_' + HOST;  // 已认领记录存储键(按站点区分)

  // 站点配置：按 hostname 识别，不同站点的"当前做种"行文字、列表加载方式不同
  const SITE_CONFIG = {
    'kamept.com': { row: /当前做种/, paginated: true },
    'www.nicept.net': { row: /目前做種/, paginated: false },
    'ptfans.cc': { row: /当前做种/, paginated: false }
  };
  const cfg = SITE_CONFIG[HOST] || null;

  // ---------- 已认领去重存储(localStorage) ----------
  function loadClaimedSet() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch (e) {
      return new Set();
    }
  }
  function saveClaimedSet(set) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(Array.from(set)));
    } catch (e) { /* 忽略存储失败 */ }
  }

  // ---------- 可视化进度面板 ----------
  let progressUI = null;
  function showProgressUI() {
    if (progressUI && document.body.contains(progressUI)) return;
    const dom = document.createElement('div');
    dom.id = 'kesaClaimProgress';
    dom.innerHTML =
      '<div style="position:fixed;right:20px;bottom:20px;z-index:99999;width:260px;padding:12px;' +
      'background:#fff;border:2px solid #c00;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.3);' +
      'font:13px/1.6 sans-serif;color:#333">' +
      '  <div style="font-weight:bold;color:#c00;margin-bottom:6px">PT种子认领进行中…</div>' +
      '  <div style="margin-bottom:6px" id="kesaClaimProgressText">准备中…</div>' +
      '  <div style="background:#eee;border-radius:4px;overflow:hidden;height:14px">' +
      '    <div id="kesaClaimProgressBar" style="height:14px;width:0%;background:#c00;transition:width .2s"></div>' +
      '  </div>' +
      '  <div style="margin-top:6px;color:#666">' +
      '    <span id="kesaClaimProgressStats">0/0</span>' +
      '    <span style="float:right">成功 <span id="kesaClaimProgressOK">0</span> · 失败 <span id="kesaClaimProgressFail">0</span></span>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(dom);
    progressUI = dom;
  }
  function updateProgressUI(index, total, ok, fail, text) {
    showProgressUI();
    const pct = total > 0 ? Math.round((index / total) * 100) : 0;
    const bar = progressUI.querySelector('#kesaClaimProgressBar');
    const txt = progressUI.querySelector('#kesaClaimProgressText');
    const stats = progressUI.querySelector('#kesaClaimProgressStats');
    const okEl = progressUI.querySelector('#kesaClaimProgressOK');
    const failEl = progressUI.querySelector('#kesaClaimProgressFail');
    if (bar) bar.style.width = pct + '%';
    if (txt) txt.textContent = text || '';
    if (stats) stats.textContent = index + '/' + total;
    if (okEl) okEl.textContent = ok;
    if (failEl) failEl.textContent = fail;
  }
  function closeProgressUI() {
    if (progressUI && progressUI.parentNode) {
      progressUI.parentNode.removeChild(progressUI);
    }
    progressUI = null;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 提交一次认领请求
   */
  function claimTorrent(torrentId) {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', SITE + '/ajax.php', true);
      xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
      xhr.onload = function () {
        if (xhr.status !== 200) {
          resolve({ ok: false, msg: 'HTTP ' + xhr.status });
          return;
        }
        try {
          const data = JSON.parse(xhr.responseText);
          if (data.ret === 0) {
            resolve({ ok: true, msg: data.msg || '', claimId: data.data && data.data.id });
          } else {
            resolve({ ok: false, msg: data.msg || 'ret=' + data.ret });
          }
        } catch (e) {
          resolve({ ok: false, msg: '解析失败' });
        }
      };
      xhr.onerror = function () {
        resolve({ ok: false, msg: '网络错误' });
      };
      xhr.send('action=addClaim&params%5Btorrent_id%5D=' + torrentId);
    });
  }

  /**
   * 从一段 HTML 中提取所有"待认领"(addClaim 未隐藏)的种子 id
   */
  function extractClaimableIds(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const ids = [];
    doc.querySelectorAll("button[data-action='addClaim']").forEach((btn) => {
      const id = btn.getAttribute('data-torrent_id');
      const display = btn.style && btn.style.display;
      if (id && display !== 'none') {
        ids.push(id);
      }
    });
    return ids;
  }

  /**
   * 找到"当前做种"行的第二个单元格
   */
  function getSectionCell() {
    const row = Array.from(document.querySelectorAll('tr')).find((tr) =>
      tr.childElementCount === 2 && cfg.row.test(tr.cells[0].innerText)
    );
    return row ? row.cells[1] : null;
  }

  /**
   * 从"当前做种"区块当前 DOM 推断总页数(仅分页站点)，返回最后一页页码(0 起步)
   */
  function getMaxPage(sectionCell) {
    let max = 0;
    sectionCell.querySelectorAll('[data-page]').forEach((a) => {
      const p = parseInt(a.getAttribute('data-page'), 10);
      if (!isNaN(p) && p > max) max = p;
    });
    return max;
  }

  /**
   * 展开折叠的做种列表(仅折叠站)。返回该块的 DOM id；已内联或无折叠块返回 null。
   */
  function expandCollapsedList(sectionCell) {
    const block = sectionCell.querySelector('div[id]');
    const blockId = block && block.id;
    if (!blockId) return null;
    try {
      if (typeof getusertorrentlistajax === 'function') {
        getusertorrentlistajax(USERID, 'seeding', blockId);
      }
      // 若元素 display:none，尝试显示(部分站点加载后仍需展示)
      const el = document.getElementById(blockId);
      if (el) {
        el.style.display = '';
      }
    } catch (e) {
      console.error('展开做种列表失败', e);
    }
    return blockId;
  }

  /**
   * 收集所有待认领种子的 id
   */
  async function collectIds() {
    const ids = new Set();
    const sectionCell = getSectionCell();
    if (!sectionCell) return ids;

    if (cfg.paginated) {
      // KamePT：列表内联，分页抓取
      extractClaimableIds(sectionCell.outerHTML).forEach((id) => ids.add(id));
      const maxPage = getMaxPage(sectionCell);
      for (let page = 1; page <= maxPage; page++) {
        const url = SITE + '/getusertorrentlistajax.php?page=' + page + '&userid=' + USERID + '&type=seeding';
        try {
          const html = await (await fetch(url)).text();
          extractClaimableIds(html).forEach((id) => ids.add(id));
        } catch (e) {
          console.error('抓取第 ' + page + ' 页失败', e);
        }
        await sleep(FETCH_INTERVAL);
      }
    } else {
      // NicePT/PTFans：列表折叠在 #ka1，自动展开后从 DOM 提取(无分页)
      const blockId = expandCollapsedList(sectionCell);
      if (blockId) {
        await sleep(EXPAND_WAIT);
        const loadedBlock = document.getElementById(blockId);
        if (loadedBlock) {
          extractClaimableIds(loadedBlock.outerHTML).forEach((id) => ids.add(id));
        }
      } else {
        // 无折叠块：直接从当前单元格提取
        extractClaimableIds(sectionCell.outerHTML).forEach((id) => ids.add(id));
      }
    }
    return ids;
  }

  /**
   * 一键认领
   */
  async function claimAll() {
    if (!cfg) {
      alert('未适配当前站点：' + HOST);
      return;
    }
    if (!getSectionCell()) {
      alert('未找到"当前做种"区块，请确认在用户详情页打开当前做种列表');
      return;
    }

    showProgressUI();
    updateProgressUI(0, 1, 0, 0, '正在收集种子…');
    const ids = await collectIds();
    const claimedSet = loadClaimedSet();

    // 过滤掉已认领过的种子
    const todo = Array.from(ids).filter((id) => !claimedSet.has(id));
    const skipped = ids.size - todo.length;

    closeProgressUI();
    if (todo.length === 0) {
      alert('未检测到待认领的做种种子' + (skipped > 0 ? '（已认领' + skipped + '个，已跳过）' : '（可能已全部认领）'));
      return;
    }

    const confirmMsg =
      '共发现 ' + ids.size + ' 个可认领种子，其中 ' + skipped + ' 个已认领(将跳过)，本次将认领 ' + todo.length + ' 个。\n\n' +
      '严正警告：\n请勿短时间内多次点击！\n每个种子间隔 ' + CLAIM_INTERVAL + 'ms，种子越多耗时越久，请耐心等待。';
    if (!confirm(confirmMsg)) return;

    showProgressUI();
    let success = 0;
    let fail = 0;
    for (let i = 0; i < todo.length; i++) {
      const id = todo[i];
      updateProgressUI(i + 1, todo.length, success, fail, '正在认领第 ' + (i + 1) + '/' + todo.length + ' 个…');
      const res = await claimTorrent(id);
      if (res.ok) {
        success++;
        claimedSet.add(id);               // 认领成功后记录，下次跳过
      } else {
        fail++;
      }
      await sleep(CLAIM_INTERVAL);
    }
    saveClaimedSet(claimedSet);
    closeProgressUI();

    alert('本次待认领 ' + todo.length + ' 个，成功 ' + success + ' 个，失败 ' + fail + ' 个' + (skipped > 0 ? '，已跳过已认领 ' + skipped + ' 个。' : '。'));
  }

  /**
   * 注入"一键认领"按钮到"当前做种"行，并自动展开折叠列表
   */
  function injectButton() {
    if (!cfg) return;
    const sectionCell = getSectionCell();
    if (!sectionCell) return;

    // 自动展开折叠列表(不依赖用户手动点"显示/隐藏")
    if (!cfg.paginated) {
      expandCollapsedList(sectionCell);
    }

    if (sectionCell.querySelector('#kesaClaimAll')) return;
    const dom = document.createElement('div');
    dom.innerHTML =
      '<a id="kesaClaimAll" href="javascript:void(0);" ' +
      'style="margin-left:10px;font-weight:bold;color:red;cursor:pointer" ' +
      'title="认领全部当前做种（自动展开列表/翻页，已认领自动跳过，运行中无法停止）">一键认领</a>';
    const a = dom.firstChild;
    a.addEventListener('click', claimAll);
    sectionCell.prepend(dom);
  }

  // 等待"当前做种"区块渲染完成后注入
  function waitAndInject() {
    injectButton();
    setTimeout(injectButton, 1000);
    setTimeout(injectButton, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitAndInject);
  } else {
    waitAndInject();
  }
})();