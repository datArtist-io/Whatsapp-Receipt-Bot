// The Slipp web app: chat with Slipp, plus the books it keeps.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let data = null, cur = '₦', filter = 'all', saleStatus = 'paid', sending = false;

  const money = (n) => (Number(n) < 0 ? '-' : '') + cur + Math.abs(Number(n || 0)).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const day = (d) => d ? new Date(String(d).length === 10 ? d + 'T12:00:00Z' : d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
  const time = (d) => new Date(d || Date.now()).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const initials = (s) => String(s || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const parseAmount = (v) => { const s = String(v || '').toLowerCase().replace(/[,\s₦$£]/g, ''); const m = s.match(/^([\d.]+)(k|m)?$/); return m ? Number(m[1]) * (m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1) : NaN; };

  function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2600); }

  async function api(path, body) {
    const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { location.replace('/start'); throw new Error('Signed out'); }
    if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong. Try again.'), { status: r.status });
    return j;
  }

  // ---------- views ----------
  const VIEWS = ['chat', 'overview', 'sales', 'customers', 'stock', 'expenses', 'settings'];
  function route() {
    const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'chat';
    $$('.view').forEach((s) => (s.hidden = s.dataset.view !== v));
    $$('#nav a, #tabbar a').forEach((a) => (a.dataset.view === v ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    document.title = v === 'chat' ? 'Slipp' : `${v[0].toUpperCase() + v.slice(1)} · Slipp`;
    if (v === 'chat') setTimeout(() => { scrollThread(false); if (matchMedia('(pointer:fine)').matches) $('#msg').focus(); }, 0);
  }
  addEventListener('hashchange', route);

  // ---------- the books ----------
  async function loadBooks() {
    data = await api('/api/dashboard?period=' + $('#period').value);
    cur = data.business.currency || '₦';
    renderBooks();
  }

  function renderBooks() {
    const b = data.business, r = data.report;
    $('#bizName').textContent = b.name || 'Your business';
    $('#bizAv').textContent = initials(b.name);
    const owed = data.unpaid.reduce((s, i) => s + i.total, 0);
    const low = data.products.filter((p) => p.stock != null && p.stock <= p.low_stock).length;
    $('#navOwed').hidden = !data.unpaid.length; $('#navOwed').textContent = data.unpaid.length;
    $('#navLow').hidden = !low; $('#navLow').textContent = low;

    // overview
    $('#kRev').textContent = money(r.revenue);
    $('#kRevSub').textContent = r.paid_sales ? `${r.paid_sales} sale${r.paid_sales === 1 ? '' : 's'}` : 'No sales yet';
    $('#kExp').textContent = money(r.expenses);
    $('#kExpSub').textContent = r.top_expenses[0] ? `Most on ${r.top_expenses[0].category}` : 'Nothing recorded';
    $('#kProfit').textContent = money(r.profit);
    $('#kProfitBox').className = 'kpi' + (r.profit < 0 ? ' loss' : r.profit > 0 ? ' gain' : '');
    $('#kOwed').textContent = money(owed);
    const late = data.unpaid.filter((i) => i.overdue).length;
    $('#kOwedSub').textContent = data.unpaid.length ? `${data.unpaid.length} invoice${data.unpaid.length === 1 ? '' : 's'}${late ? `, ${late} overdue` : ''}` : 'All paid up';
    const max = Math.max(1, ...data.series.flatMap((m) => [m.revenue, m.expenses]));
    $('#chart').innerHTML = data.series.map((m, i) => `<div class="m" title="${esc(money(m.revenue))} sales, ${esc(money(m.expenses))} spent"><div class="bars"><i style="height:${(m.revenue / max) * 100}%;animation-delay:${i * 50}ms"></i><i class="x" style="height:${(m.expenses / max) * 100}%;animation-delay:${i * 50 + 25}ms"></i></div><span>${new Date(m.month + '-15').toLocaleDateString(undefined, { month: 'short' })}</span></div>`).join('');
    const rank = (rows, f, none) => rows.length ? rows.map(f).join('') : `<li class="none">${none}</li>`;
    $('#best').innerHTML = rank(r.best_sellers, (x) => `<li><span class="nm">${esc(x.name)} <small>× ${x.qty}</small></span><b>${esc(money(x.amount))}</b></li>`, 'Your best sellers show up here.');
    $('#bestCust').innerHTML = rank(r.best_customers, (x) => `<li><span class="nm">${esc(x.name)}</span><b>${esc(money(x.amount))}</b></li>`, 'Name customers when you record sales.');

    renderSales();
    $('#custRows').innerHTML = data.customers.length ? data.customers.map((c) => `
      <div class="row"><span class="ic">${esc(initials(c.name))}</span>
        <span class="t"><b>${esc(c.name)}</b><small>${[c.phone, `${c.invoices} sale${c.invoices === 1 ? '' : 's'}`, c.last_purchase ? 'last ' + day(c.last_purchase) : ''].filter(Boolean).map(esc).join(' · ')}</small></span>
        <span class="amt">${esc(money(c.paid_total))}<small class="${c.owing ? 'late' : ''}">${c.owing ? 'owes ' + esc(money(c.owing)) : 'paid up'}</small></span><span></span></div>`).join('')
      : empty('No customers yet', 'Name the customer when you record a sale and they appear here, with what they owe.');
    $('#prodRows').innerHTML = data.products.length ? data.products.map((p) => {
      const lowNow = p.stock != null && p.stock <= p.low_stock;
      return `<div class="row"><span class="ic ${lowNow ? 'late' : ''}"><svg viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/></svg></span>
        <span class="t"><b>${esc(p.name)}</b><small>${p.price == null ? 'No price saved' : esc(money(p.price)) + ' each'}</small></span>
        <span class="amt">${p.stock == null ? '<small>Not counted</small>' : `${p.stock}<small class="${lowNow ? 'late' : ''}">${p.stock === 0 ? 'out of stock' : lowNow ? 'running low' : 'in stock'}</small>`}</span><span></span></div>`;
    }).join('') : empty('No products yet', 'Add what you sell with its price. Then you can just say "sold 3 rice" and Slipp knows the price.');
    $('#expRows').innerHTML = data.expenses.length ? data.expenses.map((e) => `
      <div class="row"><span class="ic"><svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h3"/></svg></span>
        <span class="t"><b>${esc(e.description)}</b><small>${esc(e.category ? e.category[0].toUpperCase() + e.category.slice(1) : 'Other')} · ${esc(day(e.spent_on))}</small></span>
        <span class="amt">${esc(money(e.amount))}</span><span></span></div>`).join('')
      : empty('No expenses yet', 'Add what you spend, like fuel, rent or stock, so your profit is real.');
    $('#custList').innerHTML = data.customers.map((c) => `<option value="${esc(c.name)}">`).join('');
    $('#prodList').innerHTML = data.products.map((p) => `<option value="${esc(p.name)}">`).join('');

    const f = $('#bizForm');
    for (const k of ['name', 'currency', 'phone', 'address', 'bank']) if (document.activeElement !== f[k]) f[k].value = b[k] || '';
    const has = (ch) => data.chats.some((c) => c.channel === ch);
    const appRow = (name, color, icon, connected, link) => `<div class="app-row"><span class="lg" style="background:${color}">${icon}</span><span class="t"><b>${name}</b><small>${connected ? 'Connected' : link ? 'Chat with Slipp there too' : 'Coming soon'}</small></span>${connected ? '<span class="on">On</span>' : link ? `<a class="btn btn-line" href="${esc(link)}" target="_blank" rel="noopener">Connect</a>` : ''}</div>`;
    $('#apps').innerHTML =
      appRow('WhatsApp', '#25D366', '<svg viewBox="0 0 24 24" fill="#fff"><path d="M12 2.2a9.8 9.8 0 0 0-8.4 14.9L2.2 21.8l4.8-1.3A9.8 9.8 0 1 0 12 2.2zm5.6 13.8c-.2.7-1.4 1.3-2 1.4-.5.1-1.2.1-1.9-.1-.4-.1-1-.3-1.7-.6-3-1.3-5-4.3-5.1-4.5-.2-.2-1.2-1.6-1.2-3s.8-2.2 1.1-2.5c.3-.3.6-.4.8-.4h.6c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .6l-.4.6-.4.5c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.6-.1l.9-1.1c.2-.3.4-.2.7-.1l2 .9c.3.1.5.2.5.3.1.2.1.6-.1 1.3z"/></svg>', has('whatsapp'), data.connect.whatsapp) +
      appRow('Telegram', '#2AABEE', '<svg viewBox="0 0 24 24" fill="#fff"><path d="M20.7 4.3 3.5 11c-1.2.5-1.1 1.2-.2 1.5l4.4 1.4 1.7 5.2c.2.6.4.8.8.8s.6-.2.9-.5l2.2-2.1 4.5 3.3c.8.5 1.4.2 1.6-.8l2.9-13.7c.3-1.3-.5-1.8-1.6-1.3zM9.6 14.6l-.3 3.5-1.4-4.6 9.4-6z"/></svg>', has('telegram'), data.connect.telegram);
    $('#acctLine').textContent = data.business.name ? `Signed in to ${data.business.name}.` : 'Signed in.';
  }

  const empty = (title, text) => `<div class="empty"><b>${esc(title)}</b><p>${esc(text)}</p></div>`;

  function renderSales() {
    const rows = filter === 'unpaid' ? data.unpaid : data.invoices.filter((i) => filter === 'all' || i.status === filter);
    $('#invRows').innerHTML = rows.length ? rows.map((i) => {
      const cls = i.status === 'paid' ? 'paid' : i.overdue ? 'late' : 'unpaid';
      const note = i.status === 'paid' ? `Paid ${day(i.paid || i.created)}` : i.overdue ? `Overdue since ${day(i.due)}` : `Due ${day(i.due)}`;
      const acts = i.status === 'unpaid'
        ? `<button class="btn btn-line" data-remind="${esc(i.number)}">Remind</button><button class="btn btn-ink" data-paid="${esc(i.number)}">Mark paid</button>`
        : `<a class="btn btn-line" href="${esc(i.share)}" target="_blank" rel="noopener">Send</a>`;
      return `<div class="row"><span class="ic ${cls}">${esc(initials(i.customer || 'Walk in'))}</span>
        <span class="t"><b>${esc(i.customer || 'Walk-in customer')}</b><small><a href="${esc(i.url)}" target="_blank" rel="noopener" class="mono">${esc(i.number)}</a> · ${esc(i.items.map((x) => `${x[1]} × ${x[0]}`).join(', '))}</small></span>
        <span class="amt">${esc(money(i.total))}<small class="${i.overdue ? 'late' : ''}">${esc(note)}</small></span>
        <span class="acts">${acts}</span></div>`;
    }).join('') : filter === 'unpaid' ? empty('Nobody owes you', 'Invoices waiting for payment show up here.')
      : empty('No sales yet', 'Tell Slipp about a sale in the chat, or tap New sale.');
  }

  $('#invFilter').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    filter = b.dataset.f; $$('#invFilter button').forEach((x) => x.setAttribute('aria-pressed', x === b)); renderSales();
  });
  $('#invRows').addEventListener('click', async (e) => {
    const paid = e.target.closest('[data-paid]'), remind = e.target.closest('[data-remind]');
    if (paid) {
      paid.disabled = true;
      try { const r = await api('/api/dashboard', { action: 'mark_paid', number: paid.dataset.paid }); toast(`${r.invoice.number} is paid. Nice.`); await loadBooks(); }
      catch (err) { toast(err.message); paid.disabled = false; }
    }
    if (remind) {
      const w = window.open('', '_blank');
      try { const r = await api('/api/dashboard', { action: 'remind', number: remind.dataset.remind }); if (w) w.location = r.url; else location.href = r.url; }
      catch (err) { if (w) w.close(); toast(err.message); }
    }
  });
  $('#period').addEventListener('change', () => loadBooks().catch((e) => toast(e.message)));

  const formData = (f) => Object.fromEntries([...new FormData(f)].map(([k, v]) => [k, String(v).trim()]).filter(([, v]) => v !== ''));
  $('#prodForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const d = formData(e.target);
    const body = { action: 'product', name: d.name };
    if (d.price) body.price = parseAmount(d.price);
    if (d.stock_change) body.stock_change = Number(d.stock_change.replace('+', ''));
    try { await api('/api/dashboard', body); e.target.reset(); toast(`${d.name} saved`); await loadBooks(); } catch (err) { toast(err.message); }
  });
  $('#expForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const d = formData(e.target);
    try { await api('/api/dashboard', { action: 'expense', ...d, amount: parseAmount(d.amount) }); e.target.reset(); toast('Expense added'); await loadBooks(); } catch (err) { toast(err.message); }
  });
  $('#bizForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/dashboard', { action: 'business', ...formData(e.target) }); toast('Saved'); await loadBooks(); } catch (err) { toast(err.message); }
  });
  $('#signOut').addEventListener('click', async () => {
    await fetch('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"logout":true}' });
    location.replace('/start?signin');
  });

  // ---------- chat ----------
  const thread = $('#thread'), box = $('#msg'), sendBtn = $('#send');
  const format = (t) => esc(t)
    .replace(/(^|[\s(])\*(\S[^*\n]*?\S|\S)\*(?=[\s).,!?:;]|$)/g, '$1<b>$2</b>')
    .replace(/\n/g, '<br>');
  function scrollThread(smooth = true) { thread.scrollTo({ top: thread.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); }

  function docCard(d) {
    const [title, ...rest] = String(d.caption || '').split(' · ');
    const amount = rest.pop() || '';
    const who = rest.join(' · ') || 'Walk-in customer';
    const unpaid = /^Invoice/.test(title);
    return `<div class="doc-card ${unpaid ? 'unpaid' : ''}"><div class="dc-body">
      <span class="kind">${esc(title)}<span class="chip">${unpaid ? 'UNPAID' : 'PAID'}</span></span>
      <span class="who">${esc(who)}</span><span class="amt">${esc(amount.replace(/\.00$/, ''))}</span></div>
      <div class="dc-acts"><a class="btn btn-green" href="${esc(d.share.url)}" target="_blank" rel="noopener">${esc(d.share.label)} on WhatsApp</a><a class="btn btn-line" href="${esc(d.url)}" target="_blank" rel="noopener">View</a></div></div>`;
  }

  function addMessage(m, animate = true) {
    $('#hello').hidden = true;
    const el = document.createElement('div');
    el.className = `msg ${m.role === 'user' ? 'me' : m.error ? 'bot err' : 'bot'}`;
    if (!animate) el.style.animation = 'none';
    el.innerHTML = `<div class="bubble">${format(m.text)}</div>`
      + (m.documents || []).map(docCard).join('')
      + ((m.buttons || []).length ? `<div class="msg-btns">${m.buttons.map((b) => `<a class="btn btn-line" href="${esc(b.url)}" ${b.url.startsWith(location.origin) ? '' : 'target="_blank" rel="noopener"'}>${esc(b.label)}</a>`).join('')}</div>` : '')
      + `<span class="when">${esc(time(m.at))}</span>`;
    thread.append(el);
    return el;
  }

  async function send(text) {
    text = text.trim();
    if (!text || sending) return;
    sending = true; sendBtn.disabled = true;
    addMessage({ role: 'user', text });
    box.value = ''; grow();
    const typing = document.createElement('div');
    typing.className = 'msg bot'; typing.innerHTML = '<div class="bubble typing" aria-label="Slipp is typing"><i></i><i></i><i></i></div>';
    thread.append(typing); scrollThread();
    try {
      const r = await api('/api/chat', { text });
      typing.remove(); addMessage(r); scrollThread();
      if ((r.documents || []).length || /record|saved|paid|added|updated/i.test(r.text)) loadBooks().catch(() => {});
    } catch (e) {
      typing.remove(); addMessage({ role: 'assistant', text: e.message, error: true }); scrollThread();
    } finally { sending = false; sendBtn.disabled = !box.value.trim(); }
  }

  function grow() { box.style.height = 'auto'; box.style.height = Math.min(box.scrollHeight, 160) + 'px'; }
  box.addEventListener('input', () => { grow(); sendBtn.disabled = sending || !box.value.trim(); });
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer:fine)').matches) { e.preventDefault(); send(box.value); } });
  $('#composer').addEventListener('submit', (e) => { e.preventDefault(); send(box.value); });
  $('#ideas').addEventListener('click', (e) => { const b = e.target.closest('[data-say]'); if (b) { box.value = b.dataset.say; grow(); sendBtn.disabled = false; box.focus(); } });

  function greet(owner) {
    const h = new Date().getHours();
    const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    $('#helloTitle').textContent = `${part}${owner ? ', ' + owner.split(' ')[0] : ''}.`;
  }

  // ---------- new sale ----------
  const dlg = $('#saleDlg');
  function itemRow() {
    const el = document.createElement('div'); el.className = 'it';
    el.innerHTML = `<input class="i" name="n" placeholder="Jollof rice" maxlength="60" list="prodList" aria-label="Item"><input class="i" name="q" value="1" inputmode="numeric" aria-label="Quantity"><input class="i" name="p" placeholder="0" inputmode="decimal" aria-label="Price for one"><button type="button" class="rm" aria-label="Remove item"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
    $('.rm', el).onclick = () => { if ($$('#items .it').length > 1) el.remove(); else $$('input', el).forEach((i) => (i.value = i.name === 'q' ? '1' : '')); total(); };
    $('[name=n]', el).addEventListener('change', (e) => {
      const p = data && data.products.find((x) => x.name.toLowerCase() === e.target.value.trim().toLowerCase());
      if (p && p.price != null && !$('[name=p]', el).value) { $('[name=p]', el).value = p.price; total(); }
    });
    return el;
  }
  const items = () => $$('#items .it').map((el) => ({ name: $('[name=n]', el).value.trim(), qty: Number($('[name=q]', el).value) || 1, price: parseAmount($('[name=p]', el).value) })).filter((i) => i.name);
  const total = () => { $('#saleTotal').textContent = money(items().reduce((s, i) => s + (i.price || 0) * i.qty, 0)); };
  $('#items').addEventListener('input', total);
  $('#addItem').onclick = () => { $('#items').append(itemRow()); $('#items .it:last-child [name=n]').focus(); };
  $('#saleStatus').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return; saleStatus = b.dataset.s;
    $$('#saleStatus button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    $('#methodF').hidden = saleStatus !== 'paid'; $('#dueF').hidden = saleStatus === 'paid';
  });
  $$('[data-new-sale]').forEach((b) => b.addEventListener('click', () => {
    $('#saleForm').reset(); $('#items').innerHTML = ''; $('#items').append(itemRow()); total();
    saleStatus = 'paid'; $$('#saleStatus button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.s === 'paid'));
    $('#methodF').hidden = false; $('#dueF').hidden = true;
    $('#saleErr').textContent = ''; $('#saleForm').hidden = false; $('#saleDone').hidden = true; dlg.showModal();
  }));
  $('#saleForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(e.target), list = items();
    if (!list.length) return ($('#saleErr').textContent = 'Add at least one item.');
    if (list.some((i) => !(i.price >= 0))) return ($('#saleErr').textContent = 'Every item needs a price.');
    $('#saleSave').disabled = true; $('#saleErr').textContent = '';
    try {
      const r = await api('/api/dashboard', { action: 'invoice', status: saleStatus, items: list, customer_name: d.customer_name, customer_phone: d.customer_phone, method: d.method, due_in_days: Number(d.due_in_days || 7) });
      const i = r.invoice;
      $('#doneTitle').textContent = `${i.status === 'paid' ? 'Receipt' : 'Invoice'} ${i.number} is ready`;
      $('#doneSub').textContent = `${i.customer || 'Walk-in customer'} · ${money(i.total)}`;
      $('#doneShare').href = i.share; $('#doneOpen').href = i.url;
      $('#saleForm').hidden = true; $('#saleDone').hidden = false;
      loadBooks().catch(() => {});
    } catch (err) { $('#saleErr').textContent = err.message; }
    finally { $('#saleSave').disabled = false; }
  });

  // dialogs close on their buttons and on a tap outside
  $$('dialog').forEach((d) => {
    d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
  });
  $('#moreBtn').addEventListener('click', () => $('#moreSheet').showModal());

  // ---------- start ----------
  (async () => {
    const q = new URLSearchParams(location.search);
    const login = q.get('login');
    if (login) {
      history.replaceState(null, '', '/app' + location.hash);
      const r = await fetch('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login }) });
      if (!r.ok) { location.replace('/start?expired'); return; }
    }
    let chat;
    try { chat = await api('/api/chat'); } catch (e) { if (e.message !== 'Signed out') document.body.innerHTML = `<p style="padding:40px;text-align:center">${esc(e.message)}</p>`; return; }
    cur = chat.business.currency || '₦';
    $('#ownerName').textContent = chat.business.owner || 'Owner';
    $('#bizName').textContent = chat.business.name || 'Your business';
    $('#bizAv').textContent = initials(chat.business.name);
    greet(chat.business.owner);
    if (chat.messages.length) chat.messages.forEach((m) => addMessage(m, false));
    else $('#hello').hidden = false;
    $('#shell').hidden = false;
    route();
    loadBooks().catch((e) => toast(e.message));
  })();
})();
