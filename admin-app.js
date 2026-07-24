'use strict';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let leads = [];
let properties = [];

async function api(url, options = {}) {
  const response = await fetch(url, options);
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || 'Помилка запиту.');
  return data;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function statusLabel(status) {
  return ({ new: 'Нова', contacted: 'Зв’язались', done: 'Завершена' })[status] || status;
}

function showApp() {
  $('#login').style.display = 'none';
  $('#app').style.display = 'block';
}

async function boot() {
  try {
    await api('/api/me');
    showApp();
    await refresh();
  } catch {
    $('#login').style.display = 'grid';
  }
}

$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#loginError').textContent = '';
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  try {
    await api('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))
    });
    showApp();
    await refresh();
  } catch (error) {
    $('#loginError').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$('#logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  location.reload();
});

$$('.tabs button').forEach((button) => button.addEventListener('click', () => {
  $$('.tabs button').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  $$('.panel').forEach((item) => item.classList.remove('active'));
  $(`#${button.dataset.tab}`).classList.add('active');
}));

async function refresh() {
  [leads, properties] = await Promise.all([
    api('/api/leads'),
    api('/api/admin/properties')
  ]);
  render();
  await loadSettingsForm();
}

function render() {
  $('#leadCount').textContent = leads.length;
  $('#newCount').textContent = leads.filter((lead) => lead.status === 'new').length;
  $('#propCount').textContent = properties.length;

  $('#leadList').innerHTML = leads.length ? leads.map((lead) => `
    <article class="row">
      <div><strong>${escapeHtml(lead.name)}</strong> <span class="badge">${escapeHtml(statusLabel(lead.status))}</span></div>
      <div><a href="tel:${escapeHtml(lead.phone)}">${escapeHtml(lead.phone)}</a>${lead.email ? ` • <a href="mailto:${escapeHtml(lead.email)}">${escapeHtml(lead.email)}</a>` : ''}</div>
      <div>${escapeHtml(lead.topic || '')}${lead.budget ? ` • Бюджет: ${escapeHtml(lead.budget)}` : ''}</div>
      <div>Зв’язок: ${escapeHtml(lead.preferred_contact || 'phone')}</div>
      <div>${escapeHtml(lead.message)}</div>
      <small>${new Date(lead.created_at).toLocaleString('uk-UA')}</small>
      <div class="actions"><button onclick="setLead(${lead.id},'contacted')">Зв’язались</button><button onclick="setLead(${lead.id},'done')">Завершено</button><button class="danger" onclick="deleteLead(${lead.id})">Видалити</button></div>
    </article>`).join('') : '<p>Заявок поки немає.</p>';

  $('#propertyList').innerHTML = properties.length ? properties.map((property) => `
    <article class="row">
      <div><strong>${escapeHtml(property.title)}</strong> <span class="badge">${property.published ? 'Опубліковано' : 'Чернетка'}</span></div>
      <div>${escapeHtml(property.district)} • $${Number(property.price || 0).toLocaleString('uk-UA')} • ${Number(property.area || 0)} м²</div>
      <div class="actions"><button onclick="editProperty(${property.id})">Редагувати</button><button class="danger" onclick="deleteProperty(${property.id})">Видалити</button></div>
    </article>`).join('') : '<p>Об’єктів поки немає.</p>';
}

window.setLead = async (id, status) => {
  await api(`/api/leads/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
  await refresh();
};

window.deleteLead = async (id) => {
  if (!confirm('Видалити заявку?')) return;
  await api(`/api/leads/${id}`, { method: 'DELETE' });
  await refresh();
};

window.deleteProperty = async (id) => {
  if (!confirm('Видалити об’єкт?')) return;
  await api(`/api/properties/${id}`, { method: 'DELETE' });
  await refresh();
};

window.editProperty = (id) => {
  const property = properties.find((item) => String(item.id) === String(id));
  if (!property) return;
  const form = $('#propertyForm');
  form.elements.property_id.value = property.id;
  form.elements.title.value = property.title || '';
  form.elements.type.value = property.type || 'apartment';
  form.elements.district.value = property.district || '';
  form.elements.status.value = property.status || 'Актуально';
  form.elements.price.value = property.price || 0;
  form.elements.area.value = property.area || 0;
  form.elements.rooms.value = property.rooms || 0;
  form.elements.description.value = property.description || '';
  form.elements.video_url.value = property.video_url || '';
  form.elements.published.checked = Boolean(property.published);
  $('#propertyFormTitle').textContent = 'Редагувати об’єкт';
  $('#cancelEdit').classList.remove('hidden');
  form.scrollIntoView({ behavior: 'smooth' });
};

function resetPropertyForm() {
  $('#propertyForm').reset();
  $('#propertyId').value = '';
  $('#propertyFormTitle').textContent = 'Додати об’єкт';
  $('#cancelEdit').classList.add('hidden');
  $('#propStatus').textContent = '';
}

$('#cancelEdit').addEventListener('click', resetPropertyForm);

$('#propertyForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const propertyId = form.elements.property_id.value;
  const status = $('#propStatus');
  const button = $('#saveProperty');
  status.textContent = 'Зберігаємо…';
  button.disabled = true;
  try {
    await api(propertyId ? `/api/properties/${propertyId}` : '/api/properties', {
      method: propertyId ? 'PATCH' : 'POST',
      body: new FormData(form)
    });
    resetPropertyForm();
    status.textContent = 'Готово.';
    await refresh();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

async function loadSettingsForm() {
  const settings = await api('/api/settings');
  const form = $('#settingsForm');
  for (const name of ['phone', 'email', 'instagram_url', 'telegram_url', 'address', 'hours']) {
    form.elements[name].value = settings[name] || '';
  }
}

$('#settingsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = $('#settingsStatus');
  status.textContent = 'Зберігаємо…';
  try {
    await api('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))
    });
    status.textContent = 'Контакти оновлено.';
  } catch (error) {
    status.textContent = error.message;
  }
});

$('#passwordForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = $('#passwordStatus');
  if (form.elements.new_password.value !== form.elements.repeat_password.value) {
    status.textContent = 'Нові паролі не збігаються.';
    return;
  }
  status.textContent = 'Змінюємо…';
  try {
    await api('/api/admin/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        current_password: form.elements.current_password.value,
        new_password: form.elements.new_password.value
      })
    });
    alert('Пароль змінено. Увійдіть з новим паролем.');
    location.reload();
  } catch (error) {
    status.textContent = error.message;
  }
});

boot();
