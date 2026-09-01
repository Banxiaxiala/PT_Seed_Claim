// ==UserScript==
// @name            PT种子认领
// @name:zh-CN      PT种子认领
// @namespace       https://github.com/Banxiaxiala/PT_Seed_Claim
// @version         0.0.1
// @description     在用户详情页一键认领全部当前做种种子（支持分页翻页自动认领所有种子）
// @description:en  One-click claim all seeding torrents on user details page (auto pages through all seeds)
// @author          Banxiaxiala
// @match           https://kamept.com/userdetails.php?id=*
// @grant           unsafeWindow
// @run-at          document-end
// @license         MIT
// ==/UserScript==

/**
 * PT种子认领
 * 改自"老师一键认领"(原 nicept 脚本)。
 * 在 kamept 用户详情页的"当前做种"行插入"一键认领"按钮，
 * 自动翻遍所有分页(getusertorrentlistajax.php?page=N)，
 * 对每个未认领的做种种子通过 ajax.php 发起 addClaim 请求。
 */
(function () {
  'use strict';

  const SITE = location.origin;            // 例如 https://kamept.com
  const CLAIM_INTERVAL = 500;              // 每个种子请求间隔(ms)，防止短时间多次点击被处理
  const USERID = (location.search.match(/[?&]id=(\d+)/) || [])[1] || '';

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 提交一次认领请求
   * @param {number|string} torrentId
   * @returns {Promise<{ok:boolean, msg:string, claimId?:string}>}
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
   * @param {string} html
   * @returns {string[]}
   */
  function extractClaimableIds(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const ids = [];
    doc.querySelectorAll("button[data-action='addClaim']").forEach((btn) => {
      const id = btn.getAttribute('data-torrent_id');
      const display = btn.style && btn.style.display;
      // 隐藏的表示已认领，跳过；未隐藏的加入待认领队列
      if (id && display !== 'none') {
        ids.push(id);
      }
    });
    return ids;
  }

  /**
   * 从"当前做种"区块当前 DOM 提取已渲染种子页数信息，返回总页数
   * 通过读取分页链接里的最大 data-page 推断
   * @param {HTMLElement} sectionCell 当前做种行的第二个单元格
   * @returns {number} 总页数(0 起步，返回最后一页页码；至少有第0页)
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
   * 一键认领：翻遍所有分页并认领每个未认领种子
   */
  async function claimAll() {
    const sectionRow = Array.from(document.querySelectorAll('tr')).find((tr) =>
      tr.childElementCount === 2 && /当前做种/.test(tr.cells[0].innerText)
    );
    if (!sectionRow) {
      alert('未找到"当前做种"区块，请确认在用户详情页打开当前做种列表');
      return;
    }
    const sectionCell = sectionRow.cells[1];

    // 1. 收集当前页(第0页)的种子 id
    const ids = new Set();
    const firstPageIds = extractClaimableIds(sectionCell.outerHTML);
    firstPageIds.forEach((id) => ids.add(id));

    // 2. 计算总页数，抓取其余各页
    const maxPage = getMaxPage(sectionCell);
    for (let page = 1; page <= maxPage; page++) {
      const url = SITE + '/getusertorrentlistajax.php?page=' + page + '&userid=' + USERID + '&type=seeding';
      try {
        const html = await (await fetch(url)).text();
        const pageIds = extractClaimableIds(html);
        pageIds.forEach((id) => ids.add(id));
      } catch (e) {
        console.error('抓取第 ' + page + ' 页失败', e);
      }
      await sleep(300); // 抓页间隔，避免过快
    }

    const list = Array.from(ids);
    if (list.length === 0) {
      alert('未检测到可认领的做种种子（可能已全部认领）');
      return;
    }

    const confirmMsg =
      '共发现 ' + list.length + ' 个待认领种子，确认全部认领？\n\n' +
      '严正警告：\n请勿短时间内多次点击！\n每个种子间隔 ' + CLAIM_INTERVAL + 'ms，种子越多耗时越久，请耐心等待弹窗结果。';
    if (!confirm(confirmMsg)) return;

    // 3. 逐个认领
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
    const sectionRow = Array.from(document.querySelectorAll('tr')).find((tr) =>
      tr.childElementCount === 2 && /当前做种/.test(tr.cells[0].innerText)
    );
    if (!sectionRow || sectionRow.cells[1].querySelector('#kesaClaimAll')) return;

    const dom = document.createElement('div');
    dom.innerHTML =
      '<a id="kesaClaimAll" href="javascript:void(0);" ' +
      'style="margin-left:10px;font-weight:bold;color:red;cursor:pointer" ' +
      'title="认领全部当前做种（自动翻遍所有分页，运行中无法停止，强制停止可关闭页面）">一键认领</a>';
    const a = dom.firstChild;
    a.addEventListener('click', claimAll);
    sectionRow.cells[1].prepend(dom);
  }

  // 等待"当前做种"区块渲染完成后注入
  function waitAndInject() {
    if (document.querySelectorAll('tr').length > 0) {
      injectButton();
    }
    // 若"当前做种"区块是点击后才加载的，需在展开时注入
    setTimeout(injectButton, 1000);
    setTimeout(injectButton, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitAndInject);
  } else {
    waitAndInject();
  }
})();
