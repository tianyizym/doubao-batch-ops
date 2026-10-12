// ==UserScript==
// @name         豆包批量删除对话记录
// @namespace    https://www.doubao.com/
// @version      3.1-dev
// @description  [开发版] 豆包网页版对话批量删除+批量导出，API直调删除（适配新版对话栏 DOM）
// @author       You
// @match        https://www.doubao.com/*
// @match        https://doubao.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ==================== 配置 ====================
    var DELAY = 300;
    var SCAN_DELAY = 400;
    var THEME = 'dark'; // 'dark' or 'light'
    var SKIP = ['主对话', '服务通知'];

    // ==================== 状态 ====================
    var count = 0;
    var running = false;
    var failStreak = 0;
    var panel = null;
    var mode = '';
    var scanResult = [];

    // ==================== 工具 ====================
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    function uuid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    function getCommonQuery() {
        var p = new URL(location.href).searchParams;
        var webId = p.get('web_id') || '';
        var params = {
            version_code: '20800', language: 'zh', device_platform: 'web',
            doubao_device_platform: 'web', aid: '497858', real_aid: '497858',
            pkg_type: 'release_version',
            device_id: p.get('device_id') || webId || '',
            pc_version: '3.33.0', doubao_pc_version: '3.33.0',
            web_id: webId, tea_uuid: p.get('tea_uuid') || webId || '',
            region: 'CN', sys_region: 'CN', samantha_web: '1',
            web_platform: 'browser', 'use-olympus-account': '1',
            web_tab_id: p.get('web_tab_id') || uuid()
        };
        var parts = [];
        for (var k in params) parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
        return parts.join('&');
    }

    function log(msg) {
        var el = document.getElementById('dbd-log');
        if (el) el.textContent = msg;
    }

    function escapeHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ==================== 滚动加载 ====================
    function countVisibleConvs() {
        return document.querySelectorAll('a[id^="conversation_"]').length;
    }

    async function scrollLoad() {
        var first = document.querySelector('a[id^="conversation_"]');
        if (!first) return;
        var box = first.parentElement;
        while (box && box !== document.body) {
            var st = getComputedStyle(box);
            if (st.overflow === 'auto' || st.overflow === 'scroll' || st.overflowY === 'auto' || st.overflowY === 'scroll') break;
            box = box.parentElement;
        }
        if (!box || box === document.body) return;

        box.scrollTop = 0;
        await sleep(300);

        var lastCount = 0;
        var noNewRounds = 0;

        for (var s = 0; s < 100; s++) {
            box.scrollTop = box.scrollHeight;
            await sleep(SCAN_DELAY);

            var currentCount = countVisibleConvs();
            if (currentCount === lastCount) noNewRounds++;
            else noNewRounds = 0;

            if (noNewRounds >= 3) break;
            lastCount = currentCount;
        }

        box.scrollTop = 0;
        await sleep(300);
    }

    // ==================== 扫描对话 ====================
    // 提取对话标题：新版标题 span 带 style="visibility: visible"，
    // 旁边还有 aria-hidden 的测量 span（文本重复），不能用 span[class*="whitespace-nowrap"] 直接取
    function getConvTitle(el) {
        var vis = el.querySelector('span[style*="visibility: visible"][class*="whitespace-nowrap"]')
            || el.querySelector('span.block.whitespace-nowrap:not([aria-hidden])');
        if (vis) return vis.textContent.trim();
        var any = el.querySelector('span[class*="whitespace-nowrap"]');
        return any ? any.textContent.trim() : '(无标题)';
    }

    // 取 section 标题：新版在 section-header 的 div[role="button"] > span 里
    function getSectionHeaderText(sec) {
        var wrap = sec.querySelector('[role="button"]');
        var span = wrap ? wrap.querySelector('span') : null;
        if (span && span.textContent.trim()) return span.textContent.trim();
        return '';
    }

    async function doScan() {
        log('正在扫描...');
        await scrollLoad();

        scanResult = [];

        // 找到所有 section
        var sections = document.querySelectorAll('section');

        for (var i = 0; i < sections.length; i++) {
            var sec = sections[i];
            var convLinks = sec.querySelectorAll('a[id^="conversation_"]');
            if (convLinks.length === 0) continue;

            // 判断是否是项目文件夹（有 data-project-id）
            var projectId = sec.getAttribute('data-project-id');
            var headerText = getSectionHeaderText(sec);
            var isRecent = !projectId && (headerText === '最近' || headerText === '');

            var groupName = '最近';
            if (projectId) {
                var titleEl = sec.querySelector('[title]');
                groupName = titleEl ? titleEl.getAttribute('title') : (headerText || '未命名项目');
            } else if (headerText) {
                groupName = headerText;
            }

            var items = [];
            for (var j = 0; j < convLinks.length; j++) {
                var el = convLinks[j];
                var t = getConvTitle(el);

                // 只对"最近"分组过滤保留项
                if (isRecent) {
                    var isSkip = false;
                    for (var s = 0; s < SKIP.length; s++) {
                        if (t === SKIP[s]) { isSkip = true; break; }
                    }
                    if (isSkip) continue;
                }

                items.push({ id: el.id, title: t, element: el, href: el.getAttribute('href') || '' });
            }

            if (items.length > 0) {
                scanResult.push({
                    type: isRecent ? 'recent' : 'folder',
                    name: groupName,
                    items: items,
                    collapsed: !isRecent
                });
            }
        }

        var total = 0;
        for (var c = 0; c < scanResult.length; c++) total += scanResult[c].items.length;
        log('扫描完成: ' + scanResult.length + ' 个分组, 共 ' + total + ' 个对话');
        showSelectModal();
    }

    // ==================== 选择弹窗 ====================
    function showSelectModal() {
        var old = document.getElementById('dbd-modal');
        if (old) old.remove();

        var modal = document.createElement('div');
        modal.id = 'dbd-modal';

        var modalBg = THEME === 'light' ? '#ffffff' : '#1e1e2e';
        var modalColor = THEME === 'light' ? '#1e1e2e' : '#cdd6f4';
        var modalBorder = THEME === 'light' ? '#e5e7eb' : '#313244';
        var modalShadow = THEME === 'light' ? '0 16px 48px rgba(0,0,0,.12)' : '0 16px 48px rgba(0,0,0,.6)';
        var headColor = THEME === 'light' ? '#111827' : '#f5e0dc';
        var closeColor = THEME === 'light' ? '#9ca3af' : '#6c7086';
        var closeHover = THEME === 'light' ? '#ef4444' : '#f38ba8';
        var toolbarBg = THEME === 'light' ? '#f9fafb' : '#313244';
        var toolbarBtnBg = THEME === 'light' ? '#e5e7eb' : '#313244';
        var toolbarBtnColor = THEME === 'light' ? '#374151' : '#cdd6f4';
        var searchBg = THEME === 'light' ? '#ffffff' : '#181825';
        var searchBorder = THEME === 'light' ? '#d1d5db' : '#45475a';
        var searchColor = THEME === 'light' ? '#1e1e2e' : '#cdd6f4';
        var listBg = THEME === 'light' ? '#ffffff' : '#1e1e2e';
        var itemBg = THEME === 'light' ? '#ffffff' : '#1e1e2e';
        var itemBorder = THEME === 'light' ? '#e5e7eb' : '#313244';
        var itemHover = THEME === 'light' ? '#f3f4f6' : '#313244';
        var footBg = THEME === 'light' ? '#f9fafb' : '#1e1e2e';
        var footBorder = THEME === 'light' ? '#e5e7eb' : '#313244';
        var cancelBg = THEME === 'light' ? '#ffffff' : 'transparent';
        var cancelBorder = THEME === 'light' ? '#d1d5db' : '#45475a';
        var cancelColor = THEME === 'light' ? '#374151' : '#cdd6f4';
        var sectionColor = THEME === 'light' ? '#6b7280' : '#585b70';
        var folderColor = THEME === 'light' ? '#7c3aed' : '#cba6f7';
        var scrollThumb = THEME === 'light' ? '#d1d5db' : '#45475a';
        var noMatchBg = THEME === 'light' ? '#f9fafb' : '#1e1e2e';
        var noMatchBorder = THEME === 'light' ? '#e5e7eb' : '#45475a';
        var noMatchColor = THEME === 'light' ? '#9ca3af' : '#6c7086';

        var css = '' +
            '#dbd-modal{position:fixed;top:0;left:0;width:100%;height:100%;z-index:1000000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center}' +
            '#dbd-modal-box{background:' + modalBg + ';color:' + modalColor + ';border-radius:16px;width:580px;max-height:80vh;display:flex;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:' + modalShadow + '}' +
            '#dbd-mhead{padding:16px 20px;border-bottom:1px solid ' + modalBorder + ';display:flex;align-items:center;justify-content:space-between}' +
            '#dbd-mhead h3{margin:0;font-size:16px;color:' + headColor + '}' +
            '#dbd-mhead .close{background:none;border:none;color:' + closeColor + ';font-size:22px;cursor:pointer;padding:0;line-height:1}' +
            '#dbd-mhead .close:hover{color:' + closeHover + '}' +
            '#dbd-toolbar{padding:10px 20px;border-bottom:1px solid ' + modalBorder + ';display:flex;gap:8px;align-items:center;flex-wrap:wrap}' +
            '#dbd-toolbar button{padding:4px 12px;border:1px solid ' + toolbarBtnBg + ';border-radius:6px;background:' + toolbarBtnBg + ';color:' + toolbarBtnColor + ';cursor:pointer;font-size:12px}' +
            '#dbd-toolbar button:hover{opacity:0.8}' +
            '#dbd-toolbar .cnt{margin-left:auto;font-size:12px;color:' + sectionColor + '}' +
            '#dbd-search{padding:8px 20px;border-bottom:1px solid ' + modalBorder + '}' +
            '#dbd-search input{width:100%;padding:8px 12px;border:1px solid ' + searchBorder + ';border-radius:8px;background:' + searchBg + ';color:' + searchColor + ';font-size:13px;outline:none;box-sizing:border-box}' +
            '#dbd-list{flex:1;overflow-y:auto;padding:8px 12px;background:' + listBg + '}' +
            '#dbd-list::-webkit-scrollbar{width:6px}' +
            '#dbd-list::-webkit-scrollbar-thumb{background:' + scrollThumb + ';border-radius:3px}' +
            '.dbd-folder{margin-bottom:4px}' +
            '.dbd-folder-head{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;cursor:pointer;transition:.15s;user-select:none}' +
            '.dbd-folder-head:hover{background:' + itemHover + '}' +
            '.dbd-folder-head .arrow{font-size:10px;color:' + sectionColor + ';transition:transform .2s;width:16px;text-align:center;flex-shrink:0}' +
            '.dbd-folder-head .arrow.open{transform:rotate(90deg)}' +
            '.dbd-folder-head .icon{font-size:14px;flex-shrink:0}' +
            '.dbd-folder-head .name{font-size:13px;font-weight:600;color:' + folderColor + ';flex:1}' +
            '.dbd-folder-head .badge{font-size:11px;color:' + sectionColor + ';background:' + toolbarBtnBg + ';padding:1px 8px;border-radius:10px}' +
            '.dbd-folder-body{padding-left:24px;display:none}' +
            '.dbd-folder-body.open{display:block}' +
            '.dbd-item{display:flex;align-items:center;gap:10px;padding:6px 10px;border-radius:8px;cursor:pointer;transition:.15s}' +
            '.dbd-item:hover{background:' + itemHover + '}' +
            '.dbd-item input{width:16px;height:16px;accent-color:#89b4fa;cursor:pointer;flex-shrink:0}' +
            '.dbd-item label{font-size:13px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}' +
            '.dbd-item .link-icon{flex-shrink:0;font-size:12px;cursor:pointer;opacity:0;transition:opacity .15s;color:#89b4fa;text-decoration:none;padding:2px 4px;border-radius:4px}' +
            '.dbd-item:hover .link-icon{opacity:1}' +
            '.dbd-item .link-icon:hover{background:' + itemHover + ';opacity:1}' +
            '.dbd-item .export-icon{flex-shrink:0;font-size:12px;cursor:pointer;opacity:0;transition:opacity .15s;color:#a6e3a1;text-decoration:none;padding:2px 4px;border-radius:4px}' +
            '.dbd-item:hover .export-icon{opacity:1}' +
            '.dbd-item .export-icon:hover{background:' + itemHover + ';opacity:1}' +
            '.dbd-section-label{font-size:11px;font-weight:600;color:' + sectionColor + ';text-transform:uppercase;letter-spacing:1px;padding:12px 10px 4px}' +
            '#dbd-mfoot{padding:12px 20px;border-top:1px solid ' + footBorder + ';display:flex;flex-wrap:nowrap;gap:10px;align-items:center;background:' + footBg + '}' +
            '#dbd-mfoot .btn-cancel{flex:1;padding:8px 12px;border:1px solid ' + cancelBorder + ';border-radius:8px;background:' + cancelBg + ';color:' + cancelColor + ';font-size:13px;cursor:pointer;white-space:nowrap}' +
            '#dbd-mfoot .btn-export{flex:1;padding:8px 12px;border:none;border-radius:8px;background:#a6e3a1;color:#1e1e2e;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}' +
            '#dbd-mfoot .btn-del{flex:1;padding:8px 12px;border:none;border-radius:8px;background:#f38ba8;color:#1e1e2e;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap}' +
            '#dbd-mfoot .btn-del:hover{opacity:0.85}' +
            '#dbd-mfoot .btn-del:disabled{opacity:0.5;cursor:not-allowed}' +
            '#dbd-mfoot .btn-export:hover{opacity:0.85}' +
            '#dbd-mfoot .btn-export:disabled{opacity:0.5;cursor:not-allowed}' +
            '';

        var listHtml = buildListHtml('');

        modal.innerHTML = '<style>' + css + '</style>' +
            '<div id="dbd-modal-box">' +
            '<div id="dbd-mhead"><h3>🗑️ 批量删除 / 📥 批量导出</h3><button class="close" id="dbd-mclose">✕</button></div>' +
            '<div id="dbd-toolbar">' +
            '<button id="dbd-sel-all">全选(最近)</button>' +
            '<button id="dbd-sel-none">全不选</button>' +
            '<button id="dbd-sel-inv">反选</button>' +
            '<span class="cnt" id="dbd-sel-cnt">已选 0</span>' +
            '</div>' +
            '<div id="dbd-search"><input type="text" id="dbd-search-input" placeholder="搜索对话标题..."></div>' +
            '<div id="dbd-list">' + listHtml + '</div>' +
            '<div id="dbd-mfoot">' +
            '<button class="btn-cancel" id="dbd-mcancel">取消</button>' +
            '<button class="btn-export" id="dbd-mexport" disabled>📥 导出选中</button>' +
            '<button class="btn-del" id="dbd-mconfirm" disabled>🗑️ 删除选中</button>' +
            '</div></div>';

        document.body.appendChild(modal);
        bindModalEvents(modal);
    }

    function buildListHtml(keyword) {
        var kw = keyword.toLowerCase();
        var html = '';

        for (var g = 0; g < scanResult.length; g++) {
            var group = scanResult[g];
            var isFolder = group.type === 'folder';

            // 过滤匹配的项
            var matchedItems = [];
            for (var i = 0; i < group.items.length; i++) {
                if (!kw || group.items[i].title.toLowerCase().indexOf(kw) >= 0) {
                    matchedItems.push({ item: group.items[i], idx: i });
                }
            }
            if (matchedItems.length === 0 && kw) continue;

            if (isFolder) {
                // 文件夹标题（无复选框，可折叠）
                var arrowClass = group.collapsed ? 'arrow' : 'arrow open';
                var bodyClass = group.collapsed ? 'dbd-folder-body' : 'dbd-folder-body open';
                html += '<div class="dbd-folder" data-group="' + g + '">';
                html += '<div class="dbd-folder-head" data-toggle="' + g + '">';
                html += '<span class="' + arrowClass + '">▶</span>';
                html += '<span class="icon">📁</span>';
                html += '<span class="name">' + escapeHtml(group.name) + '</span>';
                html += '<span class="badge">' + group.items.length + ' 个对话</span>';
                html += '</div>';
                html += '<div class="' + bodyClass + '" data-body="' + g + '">';
                for (var m = 0; m < matchedItems.length; m++) {
                    var mi = matchedItems[m];
                    html += '<div class="dbd-item"><input type="checkbox" id="dbd-cb-' + g + '-' + mi.idx + '" data-group="' + g + '" data-idx="' + mi.idx + '"><label>' + escapeHtml(mi.item.title) + '</label><a class="export-icon" data-group="' + g + '" data-idx="' + mi.idx + '" title="导出为Markdown">📥</a><a class="link-icon" data-href="' + escapeHtml(mi.item.href) + '" title="在新标签页打开">↗</a></div>';
                }
                html += '</div></div>';
            } else {
                // 最近：平铺，有全选功能
                html += '<div class="dbd-section-label">📌 最近</div>';
                for (var n = 0; n < matchedItems.length; n++) {
                    var ni = matchedItems[n];
                    html += '<div class="dbd-item"><input type="checkbox" id="dbd-cb-' + g + '-' + ni.idx + '" data-group="' + g + '" data-idx="' + ni.idx + '"><label>' + escapeHtml(ni.item.title) + '</label><a class="export-icon" data-group="' + g + '" data-idx="' + ni.idx + '" title="导出为Markdown">📥</a><a class="link-icon" data-href="' + escapeHtml(ni.item.href) + '" title="在新标签页打开">↗</a></div>';
                }
            }
        }

        if (!html) html = '<div style="padding:30px;text-align:center;color:#6c7086">没有匹配的对话</div>';
        return html;
    }

    function bindModalEvents(modal) {
        // 关闭
        document.getElementById('dbd-mclose').onclick = function () { modal.remove(); };
        document.getElementById('dbd-mcancel').onclick = function () { modal.remove(); };
        modal.onclick = function (e) { if (e.target === modal) modal.remove(); };

        // 文件夹折叠
        modal.addEventListener('click', function (e) {
            var toggle = e.target.closest('[data-toggle]');
            if (toggle) {
                var g = toggle.getAttribute('data-toggle');
                var body = modal.querySelector('[data-body="' + g + '"]');
                var arrow = toggle.querySelector('.arrow');
                if (body) {
                    var isOpen = body.classList.toggle('open');
                    if (arrow) arrow.classList.toggle('open', isOpen);
                }
            }
        });

        // 全选（只选"最近"区域）
        document.getElementById('dbd-sel-all').onclick = function () {
            var cbs = modal.querySelectorAll('#dbd-list input[type="checkbox"]');
            for (var i = 0; i < cbs.length; i++) {
                var gi = parseInt(cbs[i].dataset.group);
                if (scanResult[gi] && scanResult[gi].type === 'recent') {
                    cbs[i].checked = true;
                }
            }
            updateSelCount();
        };

        // 全不选
        document.getElementById('dbd-sel-none').onclick = function () {
            var cbs = modal.querySelectorAll('#dbd-list input[type="checkbox"]');
            for (var i = 0; i < cbs.length; i++) cbs[i].checked = false;
            updateSelCount();
        };

        // 反选
        document.getElementById('dbd-sel-inv').onclick = function () {
            var cbs = modal.querySelectorAll('#dbd-list input[type="checkbox"]');
            for (var i = 0; i < cbs.length; i++) cbs[i].checked = !cbs[i].checked;
            updateSelCount();
        };

        // 搜索
        document.getElementById('dbd-search-input').oninput = function () {
            document.getElementById('dbd-list').innerHTML = buildListHtml(this.value);
            updateSelCount();
        };

        // checkbox 变化
        modal.addEventListener('change', function (e) {
            if (e.target.type === 'checkbox') updateSelCount();
        });

        // 点击行切换选中（排除复选框自身和跳转图标）
        modal.addEventListener('click', function (e) {
            if (e.target.closest('.link-icon')) return;
            var item = e.target.closest('.dbd-item');
            if (item && e.target.type !== 'checkbox') {
                var cb = item.querySelector('input[type="checkbox"]');
                if (cb) { cb.checked = !cb.checked; updateSelCount(); }
            }
        });

        // 点击跳转图标在新标签页打开
        modal.addEventListener('click', function (e) {
            var icon = e.target.closest('.link-icon');
            if (icon) {
                e.stopPropagation();
                var href = icon.dataset.href;
                if (href) {
                    window.open(location.origin + href, '_blank');
                }
            }
        });

        // 点击导出图标导出单个对话
        modal.addEventListener('click', function (e) {
            var icon = e.target.closest('.export-icon');
            if (icon) {
                e.stopPropagation();
                var gi = parseInt(icon.dataset.group);
                var idx = parseInt(icon.dataset.idx);
                if (scanResult[gi] && scanResult[gi].items[idx]) {
                    var item = scanResult[gi].items[idx];
                    icon.textContent = '⏳';
                    icon.style.opacity = '1';
                    exportConversation(item).then(function(ok) {
                        icon.textContent = ok ? '✅' : '❌';
                        setTimeout(function() { icon.textContent = '📥'; }, 2000);
                    });
                }
            }
        });

        // 确认删除
        document.getElementById('dbd-mconfirm').onclick = function () {
            var selected = getSelectedItems();
            if (selected.length === 0) return;
            modal.remove();
            startDelete(selected);
        };

        // 批量导出
        document.getElementById('dbd-mexport').onclick = function () {
            var selected = getSelectedItems();
            if (selected.length === 0) return;
            modal.remove();
            startExport(selected);
        };
    }

    function updateSelCount() {
        var cbs = document.querySelectorAll('#dbd-list input[type="checkbox"]');
        var n = 0;
        for (var i = 0; i < cbs.length; i++) { if (cbs[i].checked) n++; }
        var el = document.getElementById('dbd-sel-cnt');
        if (el) el.textContent = '已选 ' + n;
        var delBtn = document.getElementById('dbd-mconfirm');
        var expBtn = document.getElementById('dbd-mexport');
        if (delBtn) delBtn.disabled = n === 0;
        if (expBtn) expBtn.disabled = n === 0;
    }

    function getSelectedItems() {
        var cbs = document.querySelectorAll('#dbd-list input[type="checkbox"]');
        var result = [];
        for (var i = 0; i < cbs.length; i++) {
            if (cbs[i].checked) {
                var gi = parseInt(cbs[i].dataset.group);
                var idx = parseInt(cbs[i].dataset.idx);
                if (scanResult[gi] && scanResult[gi].items[idx]) {
                    result.push(scanResult[gi].items[idx]);
                }
            }
        }
        return result;
    }

    // ==================== 导出逻辑 ====================
    async function exportConversation(item) {
        var md = await fetchConversationMd(item);
        if (!md) return false;
        downloadFile(item.title + '.md', md);
        return true;
    }

    function downgradeHeadings(text) {
        // 把 # 变成 ####，## 变成 #####，### 变成 ######，统一降两级
        return text.replace(/^(#{1,6}) /gm, function(match, hashes) {
            return hashes + '## ';
        });
    }

    function extractText(msg) {
        if (msg.content_block && msg.content_block.length > 0) {
            var parts = [];
            for (var i = 0; i < msg.content_block.length; i++) {
                var block = msg.content_block[i];
                if (block.block_type === 10000 && block.content && block.content.text_block && block.content.text_block.text) {
                    parts.push(block.content.text_block.text);
                }
            }
            if (parts.length > 0) return parts.join('\n');
        }
        if (msg.tts_content) return msg.tts_content;
        if (msg.brief) return msg.brief;
        if (msg.content && typeof msg.content === 'string' && msg.content) return msg.content;
        return '';
    }

    function downloadFile(filename, content, mimeType) {
        var blob = content instanceof Blob ? content : new Blob([content], { type: mimeType || 'text/markdown;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function loadJSZip() {
        return new Promise(function (resolve, reject) {
            if (window.JSZip) { resolve(window.JSZip); return; }
            var s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/jszip@3/dist/jszip.min.js';
            s.onload = function () { resolve(window.JSZip); };
            s.onerror = function () { reject(new Error('JSZip load failed')); };
            document.head.appendChild(s);
        });
    }

    async function startExport(items) {
        running = true;
        count = 0;
        failStreak = 0;
        mode = 'export';
        var total = items.length;
        updatePanel();

        // 单个对话直接下载 md
        if (total === 1) {
            log('导出: ' + items[0].title);
            var ok = await exportConversation(items[0]);
            running = false;
            log(ok ? '导出成功' : '导出失败');
            updatePanel();
            return;
        }

        // 多个对话打包成 zip
        log('加载打包工具...');
        try { await loadJSZip(); } catch (e) {
            log('JSZip 加载失败，逐个下载');
            for (var i = 0; i < items.length; i++) {
                if (!running) break;
                await exportConversation(items[i]);
                count++;
                updatePanel();
            }
            running = false;
            log('完成！导出 ' + count + ' 个');
            updatePanel();
            return;
        }

        var zip = new JSZip();
        log('开始导出 ' + total + ' 个对话...');

        for (var j = 0; j < items.length; j++) {
            if (!running) { log('用户停止'); break; }
            log('[' + (j + 1) + '/' + total + '] ' + items[j].title);

            var md = await fetchConversationMd(items[j]);
            if (md) {
                var safeTitle = items[j].title.replace(/[\\/:*?"<>|]/g, '_').substring(0, 60);
                // 处理重名
                var fname = safeTitle + '.md';
                var k = 1;
                while (zip.files[fname]) { fname = safeTitle + '(' + (k++) + ').md'; }
                zip.file(fname, md);
                count++;
                log('已打包 #' + count);
            } else {
                failStreak++;
                log('获取失败');
                if (failStreak >= 5) { log('连续失败 5 次，停止'); break; }
            }
            await sleep(300);
        }

        if (count > 0) {
            log('正在生成 zip...');
            var content = await zip.generateAsync({ type: 'blob' });
            downloadFile('豆包对话导出(' + count + '个).zip', content, 'application/zip');
            log('完成！共打包 ' + count + ' 个对话');
        } else {
            log('没有成功导出任何对话');
        }

        running = false;
        updatePanel();
    }

    async function fetchConversationMd(item) {
        var convId = item.id.replace('conversation_', '');
        var title = item.title || '对话';
        try {
            var url = 'https://www.doubao.com/im/chain/single?version_code=20800&aid=497858&device_platform=web';
            var seqId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                var r = Math.random() * 16 | 0;
                return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
            });
            var body = {
                cmd: 3100, uplink_body: { pull_singe_chain_uplink_body: {
                    conversation_id: convId, anchor_index: 9007199254740991,
                    conversation_type: 3, direction: 1, limit: 200, ext: {},
                    filter: { index_list: [] }, evaluate_ab_params: "", evaluate_common_params: ""
                }}, sequence_id: seqId, channel: 2, version: "1"
            };
            var resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json; encoding=utf-8' },
                body: JSON.stringify(body), credentials: 'include'
            });
            if (!resp.ok) return null;
            var data = await resp.json();
            var messages = [];
            if (data && data.downlink_body && data.downlink_body.pull_singe_chain_downlink_body) {
                messages = data.downlink_body.pull_singe_chain_downlink_body.messages || [];
            }
            if (messages.length === 0) return null;
            messages.reverse();
            var md = '# ' + title + '\n\n';
            for (var i = 0; i < messages.length; i++) {
                var msg = messages[i];
                var text = extractText(msg);
                if (!text) continue;
                var time = '';
                if (msg.create_time) {
                    var d = new Date(parseInt(msg.create_time) * 1000);
                    time = d.getFullYear() + '/' + (d.getMonth()+1) + '/' + d.getDate() + ' ' +
                           d.getHours().toString().padStart(2,'0') + ':' +
                           d.getMinutes().toString().padStart(2,'0') + ':' +
                           d.getSeconds().toString().padStart(2,'0');
                }
                if (msg.user_type === 1) {
                    var heading = text.split('\n')[0].replace(/[#*`>\[\]]/g, '').trim();
                    if (heading.length > 80) heading = heading.substring(0, 80) + '...';
                    md += '## 我: ' + heading + '\n\n';
                } else {
                    md += '## 👧 回答' + (time ? ' `' + time + '`' : '') + '\n\n';
                    md += downgradeHeadings(text) + '\n\n';
                }
                md += '---\n\n';
            }
            return md;
        } catch (e) { return null; }
    }

    // ==================== 删除逻辑（API 直调） ====================
    async function deleteOne(item) {
        var convId = item.id.replace('conversation_', '');
        var url = 'https://www.doubao.com/im/conversation/batch_del_user_conv?' + getCommonQuery();
        var body = {
            cmd: 4171,
            uplink_body: {
                batch_delete_user_conversation_uplink_body: {
                    conversation_id: [convId],
                    delete_all: false,
                    conversation_type: 3
                }
            },
            sequence_id: uuid(),
            channel: 2,
            version: '1'
        };
        try {
            var resp = await fetch(url, {
                method: 'POST',
                mode: 'cors',
                credentials: 'include',
                referrer: 'https://www.doubao.com/chat/?from_login=1',
                headers: {
                    'accept': 'application/json, text/plain, */*',
                    'content-type': 'application/json; encoding=utf-8',
                    'agw-js-conv': 'str'
                },
                body: JSON.stringify(body)
            });
            return resp.ok;
        } catch (e) {
            return false;
        }
    }

    async function startDelete(items) {
        running = true;
        count = 0;
        failStreak = 0;
        mode = 'delete';
        var total = items.length;
        updatePanel();
        log('开始删除 ' + total + ' 个对话（API直调）...');

        for (var i = 0; i < items.length; i++) {
            if (!running) { log('用户停止，已删除 ' + count + ' 个'); break; }

            log('[' + (i + 1) + '/' + total + '] ' + items[i].title);
            var ok = await deleteOne(items[i]);

            if (ok) { count++; failStreak = 0; log('删除成功 #' + count); }
            else { failStreak++; log('删除失败'); if (failStreak >= 5) { log('连续失败 5 次，停止'); break; } }
            await sleep(DELAY);
            updatePanel();
        }

        running = false;
        log('完成！删除 ' + count + ' / ' + total + ' 个');
        updatePanel();
    }

    // ==================== UI 面板 ====================
    function updatePanel() {
        var cnt = document.getElementById('dbd-count');
        var stopBtn = document.getElementById('dbd-stop');
        var scanBtn = document.getElementById('dbd-scan');
        if (cnt) cnt.textContent = (mode === 'export' ? '已导出: ' : '已删除: ') + count;
        if (stopBtn) stopBtn.style.display = running ? 'block' : 'none';
        if (scanBtn) scanBtn.disabled = running;
    }

    function getThemeCSS() {
        if (THEME === 'light') {
            return '#dbd-panel{background:#ffffff;color:#1e1e2e;border:1px solid #e0e0e0;box-shadow:0 8px 32px rgba(0,0,0,.12)}' +
                '#dbd-panel h3{color:#1e1e2e}' +
                '#dbd-scan{background:#2563eb;color:#fff}' +
                '#dbd-scan:disabled{background:#d1d5db;color:#9ca3af}' +
                '#dbd-count{color:#059669}' +
                '#dbd-stop{background:#f59e0b;color:#fff}' +
                '#dbd-log{background:#f3f4f6;color:#4b5563}' +
                '#dbd-close{color:#9ca3af}' +
                '#dbd-close:hover{color:#ef4444}' +
                '#dbd-settings{border-top:1px solid #e5e7eb}' +
                '#dbd-scan-delay{background:#f9fafb;border:1px solid #d1d5db;color:#1e1e2e}' +
                '#dbd-theme-btn{background:#f3f4f6;color:#1e1e2e;border:1px solid #d1d5db}';
        }
        return '#dbd-panel{background:#1e1e2e;color:#cdd6f4;border:1px solid #45475a;box-shadow:0 8px 32px rgba(0,0,0,.5)}' +
            '#dbd-panel h3{color:#f5e0dc}' +
            '#dbd-scan{background:#89b4fa;color:#1e1e2e}' +
            '#dbd-scan:disabled{background:#45475a;color:#6c7086}' +
            '#dbd-count{color:#a6e3a1}' +
            '#dbd-stop{background:#f39c12;color:#1e1e2e}' +
            '#dbd-log{background:#181825;color:#a6adc8}' +
            '#dbd-close{color:#6c7086}' +
            '#dbd-close:hover{color:#f38ba8}' +
            '#dbd-settings{border-top:1px solid #313244}' +
            '#dbd-scan-delay{background:#181825;border:1px solid #45475a;color:#cdd6f4}' +
            '#dbd-theme-btn{background:#313244;color:#cdd6f4;border:1px solid #45475a}';
    }

    function createUI() {
        if (panel) return;
        panel = document.createElement('div');
        panel.id = 'dbd-panel';
        panel.innerHTML = '<style>' +
            '#dbd-panel{position:fixed;top:12px;right:12px;z-index:999999;border-radius:14px;padding:16px;width:240px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px;cursor:move;user-select:none}' +
            '#dbd-panel h3{margin:0 0 12px;font-size:15px;text-align:center}' +
            '#dbd-scan{width:100%;padding:10px;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;transition:.2s}' +
            '#dbd-scan:hover{filter:brightness(1.1)}' +
            '#dbd-count{text-align:center;margin:8px 0;font-size:14px;font-weight:bold}' +
            '#dbd-stop{width:100%;padding:8px;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;display:none;margin-top:6px}' +
            '#dbd-log{margin-top:8px;padding:8px;border-radius:6px;font-size:12px;word-break:break-all;min-height:18px;max-height:48px;overflow-y:auto}' +
            '#dbd-close{position:absolute;top:8px;right:10px;background:none;border:none;font-size:18px;cursor:pointer;padding:0;line-height:1}' +
            '#dbd-settings{margin-top:8px;padding-top:8px;font-size:11px}' +
            '#dbd-settings label{display:flex;align-items:center;gap:6px;margin-bottom:4px}' +
            '#dbd-scan-delay{width:54px;border-radius:4px;padding:2px 4px;text-align:center;font-size:11px}' +
            '#dbd-theme-btn{padding:3px 8px;border-radius:6px;font-size:11px;cursor:pointer}' +
            getThemeCSS() +
            '</style>' +
            '<button id="dbd-close">✕</button>' +
            '<h3>豆包批量删除/导出</h3>' +
            '<div id="dbd-count">已删除: 0</div>' +
            '<button id="dbd-scan">扫描对话</button>' +
            '<button id="dbd-stop">⏹ 停止</button>' +
            '<div id="dbd-settings">' +
            '<label>扫描间隔: <input id="dbd-scan-delay" type="number" value="' + SCAN_DELAY + '" min="100" max="3000" step="100"> ms</label>' +
            '<span>主题: </span><button id="dbd-theme-btn">' + (THEME === 'dark' ? '切换亮色' : '切换暗色') + '</button>' +
            '</div>' +
            '<div id="dbd-log">点击「扫描对话」开始</div>';
        document.body.appendChild(panel);

        var dx, dy, dragging = false;
        panel.addEventListener('mousedown', function (e) {
            if (e.target.tagName === 'BUTTON') return;
            dragging = true; dx = e.clientX - panel.offsetLeft; dy = e.clientY - panel.offsetTop;
        });
        document.addEventListener('mousemove', function (e) {
            if (!dragging) return;
            panel.style.left = (e.clientX - dx) + 'px'; panel.style.right = 'auto'; panel.style.top = (e.clientY - dy) + 'px';
        });
        document.addEventListener('mouseup', function () { dragging = false; });

        document.getElementById('dbd-close').onclick = function () { running = false; panel.remove(); panel = null; };
        document.getElementById('dbd-scan').onclick = function () { doScan(); };
        document.getElementById('dbd-stop').onclick = function () { running = false; log('正在停止...'); };
        document.getElementById('dbd-scan-delay').onchange = function () {
            var v = parseInt(this.value);
            if (v >= 100 && v <= 3000) SCAN_DELAY = v;
        };
        document.getElementById('dbd-theme-btn').onclick = function () {
            THEME = THEME === 'dark' ? 'light' : 'dark';
            panel.remove();
            panel = null;
            createUI();
        };
    }

    // ==================== 初始化 ====================
    function init() {
        if (location.hostname.indexOf('doubao.com') < 0) return;
        setTimeout(createUI, 3000);
    }

    if (document.readyState === 'complete') { init(); }
    else { window.addEventListener('load', init); }

    var lastHref = location.href;
    new MutationObserver(function () {
        if (location.href !== lastHref) { lastHref = location.href; if (!panel) init(); }
    }).observe(document, { childList: true, subtree: true });

})();