// ==UserScript==
// @name            PT种子认领
// @name:zh-CN      PT种子认领
// @namespace       https://github.com/Banxiaxiala/PT_Seed_Claim
// @version         0.1.0
// @description     在用户详情页一键认领全部当前做种种子（支持分页翻页、折叠列表展开，自动认领所有做种种子）
// @description:en  One-click claim all seeding torrents on user details page (supports pagination & collapsed lists)
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
  const CLAIM_INTERVAL = 500;              // 每个种子请求间隔(ms)，防止短时间多次点击被处理
  const FETCH_INTERVAL = 300;              // 抓取分页间隔(ms)
  const USERID = (location.search.match(/[?&]id=(\d+)/) || [])[1] || '';

  // 站点配置：按 hostname 识别，不同站点的"当前做种"行文字、列表加载方式不同
  const SITE_CONFIG = {
    'kamept.com': { row: /当前做种/, paginated: true },
    'www.nicept.net': { row: /目前做種/, paginated: false },
    'ptfans.cc': { row: /当前做种/, paginated: false }
  };
  const cfg = SITE_CONFIG[location.hostname] || null;

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
      // NicePT/PTFans：列表折叠在 #ka1，先尝试触发加载，再抓取(无分页)
      const block = sectionCell.querySelector('div[id]');
      const blockId = block && block.id;
      if (blockId) {
        try {
          if (typeof getusertorrentlistajax === 'function') {
            getusertorrentlistajax(USERID, 'seeding', blockId);
          } else {
            // 无全局函数时直接 fetch
            const html = await (await fetch(SITE + '/getusertorrentlistajax.php?userid=' + USERID + '&type=seeding')).text();
            extractClaimableIds(html).forEach((id) => ids.add(id));
          }
        } catch (e) {
          console.error('加载做种列表失败', e);
        }
        // 等待列表渲染后从 DOM 提取
        await sleep(2000);
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
      alert('未适配当前站点：' + location.hostname);
      return;
    }
    if (!getSectionCell()) {
      alert('未找到"' + (cfg.row.source || '当前做种') + '"区块，请确认在用户详情页打开当前做种列表');
      return;
    }

    const ids = await collectIds();
    const list = Array.from(ids);
    if (list.length === 0) {
      alert('未检测到可认领的做种种子（可能已全部认领）');
      return;
    }

    const confirmMsg =
      '共发现 ' + list.length + ' 个待认领种子，确认全部认领？\n\n' +
      '严正警告：\n请勿短时间内多次点击！\n每个种子间隔 ' + CLAIM_INTERVAL + 'ms，种子越多耗时越久，请耐心等待弹窗结果。';
    if (!confirm(confirmMsg)) return;

    let success = 0;
    let fail = 0;
    const btn = document.getElementById('kesaClaimAll');
    for (let i = 0; i < list.length; i++) {
      if (btn) {
        btn.textContent = '认领中 ' + (i + 1) + '/' + list.length + '（成功' + success + '）';
        btn.disabled = true;
      }
      const res = await claimTorrent(list[i]);
      if (res.ok) {
        success++;
      } else {
        fail++;
      }
      await sleep(CLAIM_INTERVAL);
    }

    if (btn) {
      btn.textContent = '一键认领';
      btn.disabled = false;
    }
    alert('共 ' + list.length + ' 个种子，成功认领 ' + success + ' 个，失败 ' + fail + ' 个。');
  }

  /**
   * 注入"一键认领"按钮到"当前做种"行
   */
  function injectButton() {
    if (!cfg) return;
    const sectionCell = getSectionCell();
    if (!sectionCell || sectionCell.querySelector('#kesaClaimAll')) return;

    const dom = document.createElement('div');
    dom.innerHTML =
      '<a id="kesaClaimAll" href="javascript:void(0);" ' +
      'style="margin-left:10px;font-weight:bold;color:red;cursor:pointer" ' +
      'title="认领全部当前做种（自动翻遍所有分页/折叠列表，运行中无法停止，强制停止可关闭页面）">一键认领</a>';
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
