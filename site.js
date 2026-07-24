'use strict';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let properties = [];

const services = [
  ['01', 'Підбір нерухомості', 'Знайду квартири, будинки й комерційні приміщення під ваш бюджет, район і терміни.', ['Перевірка актуальності', 'Організація переглядів', 'Переговори щодо ціни']],
  ['02', 'Продаж нерухомості', 'Підготую об’єкт до виходу на ринок і проведу угоду від оцінки до передачі ключів.', ['Аналіз ринку', 'Фото та презентація', 'Робота із запитами покупців']],
  ['03', 'Перевірка документів', 'Допоможу знизити ризики та зрозуміло поясню юридичні й технічні нюанси.', ['Перевірка власності', 'Аналіз обтяжень', 'Координація з нотаріусом']],
  ['04', 'Оцінка вартості', 'Визначу реалістичну ринкову ціну без завищених очікувань і втрати часу.', ['Порівняння аналогів', 'Аналіз попиту', 'Стратегія ціни']],
  ['05', 'Переговори', 'Захищаю інтереси клієнта й допомагаю узгодити безпечні та вигідні умови.', ['Аргументація ціни', 'Фіксація домовленостей', 'Контроль важливих умов']],
  ['06', 'Повний супровід', 'Контролюю процес від першої консультації до остаточного розрахунку та ключів.', ['План дій', 'Координація учасників', 'Підтримка після угоди']]
];

const reviews = [
  ['Анна та Сергій', 'Знайшли квартиру за два тижні. Олег перевірив документи, домовився про знижку й був поруч до передачі ключів.'],
  ['Ірина', 'Продаж пройшов спокійно та зрозуміло. Отримувала чіткі пояснення після кожного етапу й не витрачала час на випадкові перегляди.'],
  ['Олександр', 'Потрібно було придбати нерухомість дистанційно. Усі питання вирішували онлайн, а на угоду я приїхав уже з повним розумінням документів.']
];

const faqs = [
  ['З чого починається робота?', 'З короткої консультації: визначаємо задачу, бюджет, терміни та ризики. Після цього ви отримуєте зрозумілий план наступних кроків.'],
  ['Чи перевіряєте ви документи?', 'Так. Перевірка документів і можливих обтяжень є частиною супроводу. За потреби залучаємо профільного юриста або нотаріуса.'],
  ['Можна працювати дистанційно?', 'Так. Консультації, підбір, відеоогляди й більшу частину підготовки можна провести онлайн.'],
  ['Скільки коштують послуги?', 'Вартість залежить від задачі та обсягу супроводу. Точні умови узгоджуються до початку роботи без прихованих платежів.']
];

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function telephoneHref(value) {
  return `tel:${String(value || '').replace(/[^+\d]/g, '')}`;
}

function renderStaticContent() {
  const serviceGrid = $('#servicesGrid');
  if (serviceGrid) {
    serviceGrid.innerHTML = services.map(([number, title, text, items]) => `
      <article class="service-card">
        <div class="num"><span>${number}</span><span class="service-icon">⌂</span></div>
        <h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p>
        <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </article>`).join('');
  }

  const reviewGrid = $('#reviewGrid');
  if (reviewGrid) {
    reviewGrid.innerHTML = reviews.map(([name, text]) => `
      <article class="review"><div class="stars">★★★★★</div><p>“${escapeHtml(text)}”</p><small>${escapeHtml(name)}</small></article>
    `).join('');
  }

  const faqList = $('#faqList');
  if (faqList) {
    faqList.innerHTML = faqs.map(([question, answer]) => `
      <details class="faq"><summary>${escapeHtml(question)}</summary><p>${escapeHtml(answer)}</p></details>
    `).join('');
  }
}

async function loadSettings() {
  try {
    const response = await fetch('/api/settings');
    if (!response.ok) throw new Error('settings');
    const settings = await response.json();
    const phone = settings.phone || '+38 (000) 000-00-00';
    const email = settings.email || 'info@example.com';
    const instagram = safeExternalUrl(settings.instagram_url);
    const telegram = safeExternalUrl(settings.telegram_url);

    for (const id of ['contactPhone', 'floatPhone']) {
      const element = $(`#${id}`);
      if (element) element.href = telephoneHref(phone);
    }
    if ($('#contactPhone')) $('#contactPhone').textContent = phone;
    if ($('#contactEmail')) {
      $('#contactEmail').textContent = email;
      $('#contactEmail').href = `mailto:${email}`;
    }
    if ($('#contactInstagram')) {
      $('#contactInstagram').href = instagram || '#contact';
      $('#contactInstagram').textContent = instagram ? 'Instagram' : 'Instagram: додайте в адмінці';
    }
    for (const id of ['contactTelegram', 'floatTelegram']) {
      const element = $(`#${id}`);
      if (element) element.href = telegram || '#contact';
    }
    for (const id of ['contactAddress', 'officeAddress']) {
      if ($(`#${id}`)) $(`#${id}`).textContent = settings.address || 'Чернівці, Україна';
    }
    for (const id of ['contactHours', 'officeHours']) {
      if ($(`#${id}`)) $(`#${id}`).textContent = settings.hours || 'Пн–Сб: 09:00–19:00';
    }
  } catch (error) {
    console.error('Не вдалося завантажити контакти', error);
  }
}

async function loadProperties() {
  try {
    const response = await fetch('/api/properties');
    if (!response.ok) throw new Error('Не вдалося завантажити об’єкти.');
    properties = await response.json();
    renderProperties(properties);
  } catch (error) {
    console.error(error);
    renderProperties([]);
  }
}

function renderProperties(items) {
  const grid = $('#propertyGrid');
  if (!grid) return;
  grid.innerHTML = items.length ? items.map((property) => `
    <article class="property" data-type="${escapeHtml(property.type)}">
      <div class="property-media">
        <img src="${escapeHtml(property.images?.[0] || 'og-image.jpg')}" alt="${escapeHtml(property.title)}">
        <span class="pill">${escapeHtml(property.status || 'Актуально')}</span>
      </div>
      <div class="property-body">
        <div class="property-location">Чернівці • ${escapeHtml(property.district)}</div>
        <h3>${escapeHtml(property.title)}</h3>
        <div class="property-meta"><span>${Number(property.area || 0)} м²</span><span>${Number(property.rooms || 0)} кім.</span></div>
        <div class="property-footer"><span class="price">$${Number(property.price || 0).toLocaleString('uk-UA')}</span><button class="details" data-id="${property.id}">Детальніше</button></div>
      </div>
    </article>`).join('') : '<p class="muted">Об’єкти скоро з’являться. Залиште заявку — підберемо актуальні варіанти.</p>';
  $$('.details').forEach((button) => button.addEventListener('click', () => openProperty(button.dataset.id)));
}

function videoMarkup(value, title) {
  const url = safeExternalUrl(value);
  if (!url) return '';
  if (/\.(mp4|webm)(\?|$)/i.test(url)) {
    return `<video controls preload="metadata" style="width:100%;border-radius:16px"><source src="${escapeHtml(url)}"></video>`;
  }
  return `<p><a href="${escapeHtml(url)}" target="_blank" rel="noopener">Переглянути відео об’єкта</a></p>`;
}

function openProperty(id) {
  const property = properties.find((item) => String(item.id) === String(id));
  if (!property) return;
  $('#projectLocation').textContent = `Чернівці • ${property.district}`;
  $('#projectTitle').textContent = property.title;
  $('#projectDescription').textContent = property.description;
  $('#projectPrice').textContent = `$${Number(property.price || 0).toLocaleString('uk-UA')}`;
  $('#projectFacts').innerHTML = `<span>${Number(property.area || 0)} м²</span><span>${Number(property.rooms || 0)} кім.</span><span>${escapeHtml(property.status || 'Актуально')}</span>`;
  $('#projectGallery').innerHTML = (property.images || []).map((image) => `<img src="${escapeHtml(image)}" alt="${escapeHtml(property.title)}">`).join('') + videoMarkup(property.video_url, property.title);
  $('#projectModal').classList.add('open');
  $('#projectModal').setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeProperty() {
  $('#projectModal')?.classList.remove('open');
  $('#projectModal')?.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

$('#projectClose')?.addEventListener('click', closeProperty);
$('#projectModal')?.addEventListener('click', (event) => {
  if (event.target === $('#projectModal')) closeProperty();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeProperty();
});

$$('.filter').forEach((button) => button.addEventListener('click', () => {
  $$('.filter').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  renderProperties(button.dataset.filter === 'all' ? properties : properties.filter((property) => property.type === button.dataset.filter));
}));

$('#leadForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = $('#formStatus');
  const submit = form.querySelector('button[type=submit]');
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.page_url = location.href;
  status.textContent = 'Надсилаємо…';
  submit.disabled = true;
  try {
    const response = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Помилка надсилання.');
    status.textContent = 'Дякуємо! Заявку отримано. Олег зв’яжеться з вами.';
    form.reset();
  } catch (error) {
    status.textContent = error.message || 'Не вдалося надіслати заявку.';
  } finally {
    submit.disabled = false;
  }
});

$('#menuBtn')?.addEventListener('click', () => $('#nav')?.classList.toggle('open'));

const cookieBanner = $('#cookieBanner');
if (cookieBanner && localStorage.getItem('cookieAccepted') !== '1') cookieBanner.classList.remove('hidden');
$('#cookieAccept')?.addEventListener('click', () => {
  localStorage.setItem('cookieAccepted', '1');
  cookieBanner?.classList.add('hidden');
});

renderStaticContent();
Promise.all([loadSettings(), loadProperties()]);
