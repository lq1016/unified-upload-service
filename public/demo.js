/**
 * 统一文件上传与图片处理服务 · 单页交互演示
 *
 * 说明：本文件必须以外部脚本引入。
 * 服务端启用 helmet 默认 CSP（script-src 'self' / script-src-attr 'none'），
 * 内联 <script> 与 onclick= 属性都会被浏览器拦截，因此所有逻辑放在这里，
 * 所有事件用 addEventListener 绑定。
 */
(function () {
  'use strict';

  var API = location.origin + '/api';
  var TOKEN = '';
  var SMALL_FILE = null;
  var LAST_FILE_ID = '';
  var MP = { uploadId: '', totalChunks: 0, uploaded: [] };
  var LAST_IMG_B64 = '';

  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /* 非阻塞提示：alert() 会卡住页面并阻塞录屏，这里改成页内浮层 */
  function toast(msg) {
    var old = document.getElementById('demoToast');
    if (old) old.remove();
    var d = document.createElement('div');
    d.id = 'demoToast';
    d.textContent = '⚠️ ' + msg;
    d.style.cssText = 'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:9999;' +
      'background:#fef3e0;color:#b45309;border:1px solid #fcd34d;border-radius:8px;' +
      'padding:10px 18px;font-size:14px;font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,.14)';
    document.body.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 3200);
  }

  /* =========================================================
   * 操作步骤标注层（录屏用）：由录制脚本通过 window.anno.* 驱动
   * - anno.on()      开启标注层
   * - anno.step()    顶部步骤条：步骤号 / 标题 / 接口
   * - anno.cap()     底部解说字幕
   * - anno.ring()    高亮某个目标元素（聚光灯 + 指针标签）
   * - anno.clear()   清除高亮（保留步骤条）
   * - anno.reset()   全部清除
   * ========================================================= */
  var anno = {
    layer: null,
    on: function () {
      if (!this.layer) this.layer = el('annoLayer');
      if (this.layer) this.layer.classList.add('on');
    },
    _mk: function (cls, html, pos) {
      var d = document.createElement('div');
      d.className = cls;
      if (html) d.innerHTML = html;
      if (pos) { d.style.left = pos.x + 'px'; d.style.top = pos.y + 'px'; }
      return d;
    },
    step: function (no, title, api) {
      this.on();
      var old = el('annoStep');
      if (old) old.remove();
      var d = this._mk('anno-step', '<span class="anno-n">' + esc(no) + '</span>' +
        '<span class="anno-t">' + esc(title) + '</span>' +
        (api ? '<span class="anno-api">' + esc(api) + '</span>' : ''));
      d.id = 'annoStep';
      this.layer.appendChild(d);
    },
    cap: function (text) {
      this.on();
      var old = el('annoCap');
      if (old) old.remove();
      var d = this._mk('anno-cap', text);
      d.id = 'annoCap';
      this.layer.appendChild(d);
    },
    ring: function (sel, label, tip) {
      this.on();
      this.clear();
      var target = typeof sel === 'string' ? document.querySelector(sel) : sel;
      if (!target) return;
      this._target = target; this._label = label; this._tip = tip;
      this._place();
      if (!this._bound) {
        this._bound = true;
        var self = this;
        window.addEventListener('scroll', function () { self._place(); }, { passive: true });
        window.addEventListener('resize', function () { self._place(); }, { passive: true });
      }
    },
    /* 页面滚动后重新定位聚光灯 / 标签 / 指针，避免标注漂移到别的内容上 */
    _place: function () {
      var target = this._target;
      if (!target || !target.isConnected) { this.clear(); return; }
      var r = target.getBoundingClientRect();
      var box = el('annoRing');
      var lb = el('annoLabel');
      var tp = el('annoTip');
      /* 目标滚出视口时隐藏标注，避免遮挡正文 */
      var visible = r.bottom > 0 && r.top < (window.innerHeight || 1080) && r.width > 0;
      if (!visible) {
        [box, lb, tp].forEach(function (n) { if (n) n.style.display = 'none'; });
        return;
      }
      [box, lb, tp].forEach(function (n) { if (n) n.style.display = ''; });
      var pad = 6;
      if (!box) {
        box = this._mk('anno-ring');
        box.id = 'annoRing';
        this.layer.appendChild(box);
      }
      box.style.left = (r.left - pad) + 'px';
      box.style.top = (r.top - pad) + 'px';
      box.style.width = (r.width + pad * 2) + 'px';
      box.style.height = (r.height + pad * 2) + 'px';
      if (this._label) {
        if (!lb) { lb = this._mk('anno-label', esc(this._label)); lb.id = 'annoLabel'; this.layer.appendChild(lb); }
        lb.style.left = (r.left + r.width / 2) + 'px';
        lb.style.top = Math.max(4, r.top - 34) + 'px';
      }
      if (this._tip) {
        if (!tp) { tp = this._mk('anno-tip', esc(this._tip)); tp.id = 'annoTip'; this.layer.appendChild(tp); }
        tp.style.left = (r.right + 18) + 'px';
        tp.style.top = (r.top + r.height / 2) + 'px';
        tp.style.transform = 'translateY(-50%)';
      }
    },
    hit: function () {
      var box = el('annoRing');
      if (box) box.classList.add('hit');
    },
    clear: function () {
      this._target = null;
      ['annoRing', 'annoLabel', 'annoTip'].forEach(function (id) {
        var n = el(id); if (n) n.remove();
      });
    },
    reset: function () {
      this.clear();
      var s = el('annoStep'); if (s) s.remove();
      var c = el('annoCap'); if (c) c.remove();
    }
  };
  window.anno = anno;

  function fmt(resp, box) {
    var ok = resp.ok;
    var head = '<span class="' + (ok ? 'ok' : 'err') + '">' + (ok ? '✓ 成功' : '✗ 失败') + '</span>  HTTP ' + resp.status;
    el(box).innerHTML = head + '\n' + esc(JSON.stringify(resp.body, null, 2));
  }

  function needLogin() {
    if (!TOKEN) { toast('请先完成第 1 步登录'); return false; }
    return true;
  }

  async function req(path, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    if (TOKEN) opts.headers['Authorization'] = 'Bearer ' + TOKEN;
    /* path 可能是 /api/xxx（绝对路径）、xxx（相对 API 前缀）或完整 URL，三种都要正确拼接 */
    var url;
    if (/^https?:\/\//i.test(path)) url = path;
    else if (path.charAt(0) === '/' && path.indexOf('/api/') === 0) url = location.origin + path;
    else url = API + path;
    try {
      var r = await fetch(url, opts);
      var body; var ct = r.headers.get('content-type') || '';
      if (ct.includes('application/json')) body = await r.json();
      else body = await r.text();
      return { ok: r.ok, status: r.status, body: body };
    } catch (e) {
      return { ok: false, status: 0, body: { error: { code: 'NETWORK', message: String(e) } } };
    }
  }

  function json(body) { return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }

  async function checkHealth() {
    var r = await req('/health');
    var ok = r.ok;
    el('svcBadge').className = 'badge ' + (ok ? 'on' : 'off');
    el('svcBadge').innerHTML = '<span class="dot"></span>服务状态：' + (ok ? '正常' : '异常');
    if (ok && r.body.data) el('storageBadge').textContent = '存储：' + (r.body.data.storage || '—');
  }

  function fillAdmin() { el('loginUser').value = 'admin'; el('loginPass').value = 'Admin@123456'; }

  async function doLogin() {
    var r = await req('/auth/login', { method: 'POST', ...json({ username: el('loginUser').value, password: el('loginPass').value }) });
    fmt(r, 'respLogin');
    if (r.ok && r.body.data) {
      TOKEN = r.body.data.token;
      el('authBadge').className = 'badge on';
      el('authBadge').innerHTML = '<span class="dot"></span>已登录：' + esc(r.body.data.user.username);
    } else {
      TOKEN = '';
      el('authBadge').className = 'badge off';
      el('authBadge').innerHTML = '<span class="dot"></span>未登录';
    }
  }

  function onSmallFile(input) {
    SMALL_FILE = input.files[0] || null;
    el('smallName').textContent = SMALL_FILE ? SMALL_FILE.name + ' (' + SMALL_FILE.size + ' 字节)' : '未选择';
    el('btnSmall').disabled = !SMALL_FILE;
  }

  async function uploadSmall() {
    if (!needLogin() || !SMALL_FILE) return;
    var fd = new FormData();
    fd.append('file', SMALL_FILE);
    var r = await req('/upload/small', { method: 'POST', body: fd });
    fmt(r, 'respSmall');
    if (r.ok && r.body.data) {
      LAST_FILE_ID = r.body.data.id;
      el('imgFileId').value = LAST_FILE_ID;
      el('signFileId').value = LAST_FILE_ID;
    }
  }

  function renderChunks() {
    var n = Math.min(MP.totalChunks, 20);
    var out = Array.from({ length: n }, function (_, i) {
      return '<div class="chunk ' + (MP.uploaded.indexOf(i) >= 0 ? 'done' : '') + '">' + i + '</div>';
    }).join('');
    if (MP.totalChunks > 20) out += '<span class="tiny">…共' + MP.totalChunks + '片</span>';
    el('chunkTrack').innerHTML = out;
  }

  async function mpInit() {
    if (!needLogin()) return;
    var size = +el('mpSize').value;
    var chunkSize = +el('mpChunk').value;
    var r = await req('/upload/multipart/init', {
      method: 'POST',
      ...json({ originalName: 'big.bin', mimeType: 'application/octet-stream', size: size, chunkSize: chunkSize })
    });
    fmt(r, 'respMp');
    if (r.ok && r.body.data) {
      MP.uploadId = r.body.data.uploadId;
      MP.totalChunks = r.body.data.totalChunks;
      MP.uploaded = [];
      renderChunks();
      el('btnC0').disabled = false;
      el('btnStatus').disabled = false;
      // 如果多于 2 片，只演示前 2 片 + 状态
      el('btnC1').disabled = MP.totalChunks < 2;
    }
  }

  async function makeChunkBlob(index) {
    var size = +el('mpSize').value;
    var chunkSize = +el('mpChunk').value;
    var len = Math.min(chunkSize, size - index * chunkSize);
    return new Blob([new Uint8Array(Math.max(len, 0)).fill(65 + index)], { type: 'application/octet-stream' });
  }

  async function mpUploadChunk(index) {
    if (!needLogin()) return;
    var fd = new FormData();
    fd.append('chunk', await makeChunkBlob(index), index + '.part');
    var r = await req('/upload/multipart/' + MP.uploadId + '/chunk/' + index, { method: 'PUT', body: fd });
    fmt(r, 'respMp');
    if (r.ok) {
      if (MP.uploaded.indexOf(index) < 0) MP.uploaded.push(index);
      renderChunks();
      el('btnMerge').disabled = false;
      if (index === 0) el('btnC1').disabled = false;
    }
  }

  async function mpStatus() {
    if (!needLogin()) return;
    var r = await req('/upload/multipart/' + MP.uploadId + '/status');
    fmt(r, 'respMp');
    if (r.ok && r.body.data) {
      MP.uploaded = r.body.data.uploadedChunks || [];
      renderChunks();
      // 注意：分片未齐时依然允许点「合并」，用来演示服务端返回 409 CHUNKS_INCOMPLETE
      el('btnMerge').disabled = false;
    }
  }

  async function mpMerge() {
    if (!needLogin()) return;
    var r = await req('/upload/multipart/' + MP.uploadId + '/merge', { method: 'POST' });
    fmt(r, 'respMp');
    if (r.ok) renderChunks();
  }

  async function uploadEvil() {
    if (!needLogin()) return;
    var bytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);
    var txt = new TextEncoder().encode('malware');
    var buf = new Uint8Array(bytes.length + txt.length);
    buf.set(bytes);
    buf.set(txt, bytes.length);
    var fd = new FormData();
    fd.append('file', new Blob([buf], { type: 'image/png' }), 'evil.png');
    var r = await req('/upload/small', { method: 'POST', body: fd });
    fmt(r, 'respEvil');
    var denied = !r.ok && r.body && r.body.error && r.body.error.code === 'MALICIOUS_FILE';
    el('denyBanner').style.display = denied ? 'block' : 'none';
  }

  async function processImage(again) {
    if (!needLogin()) return;
    var fileId = el('imgFileId').value.trim();
    if (!fileId) { toast('请先上传一张图片（步骤2），或手动填入 fileId'); return; }
    var payload = {
      fileId: fileId,
      width: +el('imgWidth').value || undefined,
      quality: +el('imgQuality').value || undefined,
      format: el('imgFormat').value,
      watermark: el('wmOn').checked,
      watermarkText: el('wmText').value,
      watermarkPosition: el('wmPos').value
    };
    var r = await req('/images/process', { method: 'POST', ...json(payload) });
    // 展示时去掉 base64（太长），单独画图
    var view = Object.assign({}, r.body);
    if (view.data && view.data.base64) {
      LAST_IMG_B64 = view.data.base64;
      delete view.data.base64;
      view.data.base64 = '<已省略，见下方预览>';
    }
    fmt({ ok: r.ok, status: r.status, body: view }, 'respImg');
    if (r.ok && r.body.data) {
      var d = r.body.data;
      var rate = (d.compressionRate * 100).toFixed(1);
      el('imgStats').innerHTML =
        '<div class="kv"><span>处理结果</span><b><span class="pill ' + (d.cached ? 'y' : 'g') + '">' +
        (d.cached ? '缓存命中 CACHE HIT' : '首次处理 MISS') + '</span></b></div>' +
        '<div class="kv"><span>压缩率</span><b>' + rate + '%</b></div>' +
        '<div class="kv"><span>原大小 → 处理后</span><b>' + d.originalSize + ' → ' + d.processedSize + ' 字节</b></div>' +
        '<div class="kv"><span>耗时</span><b>' + d.durationMs + ' ms</b></div>' +
        '<div class="kv"><span>格式 / 尺寸</span><b>' + d.format + ' · ' + d.width + '×' + d.height + '</b></div>';
      if (LAST_IMG_B64 && d.mimeType) {
        var img = el('imgPreview');
        img.src = 'data:' + d.mimeType + ';base64,' + LAST_IMG_B64;
        img.style.display = 'block';
      }
    }
  }

  async function signAccess() {
    if (!needLogin()) return;
    var fileId = el('signFileId').value.trim();
    if (!fileId) { toast('请先上传一张图片（步骤2），或手动填入 fileId'); return; }
    var r = await req('/access/sign', { method: 'POST', ...json({ fileId: fileId }) });
    fmt(r, 'respSign');
    if (r.ok && r.body.data) {
      var url = r.body.data.url;
      el('signUrl').innerHTML = '签名 URL：<b>' + esc(url) + '</b>';
      var ar = await req(url);
      fmt({
        ok: ar.ok,
        status: ar.status,
        body: { note: '合法签名访问结果', contentType: ar.status === 200 ? '文件二进制（已成功返回）' : ar.body }
      }, 'respSign');
    }
  }

  async function accessWithBadToken() {
    var fileId = el('signFileId').value.trim();
    if (!fileId) { toast('请先填入 fileId'); return; }
    var r = await req('/access/file?fileId=' + encodeURIComponent(fileId) + '&token=bad');
    fmt(r, 'respSign');
  }

  async function loadLogs() {
    if (!needLogin()) return;
    var r = await req('/access/logs');
    fmt(r, 'respLogs');
  }

  function bind() {
    el('btnLogin').addEventListener('click', doLogin);
    el('btnAdmin').addEventListener('click', fillAdmin);
    el('btnSmall').addEventListener('click', uploadSmall);
    el('smallFile').addEventListener('change', function (e) { onSmallFile(e.target); });
    el('filebox').addEventListener('click', function (e) {
      if (e.target !== el('smallFile')) el('smallFile').click();
    });
    el('btnMpInit').addEventListener('click', mpInit);
    el('btnC0').addEventListener('click', function () { mpUploadChunk(0); });
    el('btnStatus').addEventListener('click', mpStatus);
    el('btnC1').addEventListener('click', function () { mpUploadChunk(1); });
    el('btnMerge').addEventListener('click', mpMerge);
    el('btnEvil').addEventListener('click', uploadEvil);
    el('btnProcess').addEventListener('click', function () { processImage(false); });
    el('btnProcessAgain').addEventListener('click', function () { processImage(true); });
    el('btnSign').addEventListener('click', signAccess);
    el('btnBadToken').addEventListener('click', accessWithBadToken);
    el('btnLogs').addEventListener('click', loadLogs);
  }

  function start() {
    bind();
    checkHealth();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
