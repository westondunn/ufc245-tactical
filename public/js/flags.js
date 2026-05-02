/**
 * public/js/flags.js
 *
 * Country-name → ISO-2 → Unicode regional-indicator flag emoji.
 * Pure module, no dependencies. Loaded as a regular script before app.js;
 * exposes window.flagFor(countryName) which returns a small <span> ready
 * for innerHTML, or '' when the name isn't recognised (graceful degrade).
 *
 * Coverage: all countries that have ever produced a UFC fighter, plus the
 * common venue countries. Aliases (USA, U.S.A., Britain) map to canonical
 * ISO-2 codes. Unknown names render no flag rather than a tofu char.
 */
(function () {
  'use strict';

  // Canonical name → ISO-2. Keep alphabetical for diffability.
  var ISO = {
    'argentina': 'AR', 'armenia': 'AM', 'australia': 'AU', 'austria': 'AT',
    'azerbaijan': 'AZ', 'belarus': 'BY', 'belgium': 'BE', 'bolivia': 'BO',
    'bosnia and herzegovina': 'BA', 'brazil': 'BR', 'bulgaria': 'BG',
    'cameroon': 'CM', 'canada': 'CA', 'chile': 'CL', 'china': 'CN',
    'colombia': 'CO', 'congo': 'CG', 'croatia': 'HR', 'cuba': 'CU',
    'czech republic': 'CZ', 'czechia': 'CZ', 'denmark': 'DK',
    'dominican republic': 'DO', 'ecuador': 'EC', 'egypt': 'EG',
    'england': 'GB', 'estonia': 'EE', 'finland': 'FI', 'france': 'FR',
    'georgia': 'GE', 'germany': 'DE', 'ghana': 'GH', 'greece': 'GR',
    'guam': 'GU', 'guyana': 'GY', 'haiti': 'HT', 'hong kong': 'HK',
    'hungary': 'HU', 'iceland': 'IS', 'india': 'IN', 'iran': 'IR',
    'iraq': 'IQ', 'ireland': 'IE', 'israel': 'IL', 'italy': 'IT',
    'jamaica': 'JM', 'japan': 'JP', 'jordan': 'JO', 'kazakhstan': 'KZ',
    'kenya': 'KE', 'kyrgyzstan': 'KG', 'latvia': 'LV', 'lithuania': 'LT',
    'mexico': 'MX', 'moldova': 'MD', 'mongolia': 'MN', 'montenegro': 'ME',
    'morocco': 'MA', 'netherlands': 'NL', 'new zealand': 'NZ',
    'nicaragua': 'NI', 'nigeria': 'NG', 'north macedonia': 'MK',
    'northern ireland': 'GB', 'norway': 'NO', 'pakistan': 'PK',
    'panama': 'PA', 'paraguay': 'PY', 'peru': 'PE', 'philippines': 'PH',
    'poland': 'PL', 'portugal': 'PT', 'puerto rico': 'PR', 'romania': 'RO',
    'russia': 'RU', 'samoa': 'WS', 'saudi arabia': 'SA', 'scotland': 'GB',
    'serbia': 'RS', 'singapore': 'SG', 'slovakia': 'SK', 'slovenia': 'SI',
    'south africa': 'ZA', 'south korea': 'KR', 'korea': 'KR', 'spain': 'ES',
    'suriname': 'SR', 'sweden': 'SE', 'switzerland': 'CH', 'taiwan': 'TW',
    'tajikistan': 'TJ', 'thailand': 'TH', 'trinidad and tobago': 'TT',
    'tunisia': 'TN', 'turkey': 'TR', 'türkiye': 'TR', 'turkiye': 'TR',
    'turkmenistan': 'TM', 'uganda': 'UG', 'ukraine': 'UA',
    'united arab emirates': 'AE', 'uae': 'AE',
    'united kingdom': 'GB', 'uk': 'GB', 'great britain': 'GB',
    'britain': 'GB', 'wales': 'GB',
    'united states': 'US', 'usa': 'US', 'u.s.a.': 'US', 'us': 'US',
    'united states of america': 'US',
    'uruguay': 'UY', 'uzbekistan': 'UZ', 'venezuela': 'VE', 'vietnam': 'VN',
    'zambia': 'ZM', 'zimbabwe': 'ZW',
  };

  function normalize(name) {
    return String(name || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9 ]/g, '')
      .replace(/\s+/g, ' ').trim();
  }

  function iso2For(name) {
    var k = normalize(name);
    if (!k) return null;
    if (ISO[k]) return ISO[k];
    // Strip leading article: "the netherlands" → "netherlands"
    if (k.indexOf('the ') === 0 && ISO[k.slice(4)]) return ISO[k.slice(4)];
    return null;
  }

  function flagEmoji(iso2) {
    if (!iso2 || iso2.length !== 2) return '';
    var BASE = 0x1F1E6;  // 🇦
    var c1 = iso2.toUpperCase().charCodeAt(0) - 65;
    var c2 = iso2.toUpperCase().charCodeAt(1) - 65;
    if (c1 < 0 || c1 > 25 || c2 < 0 || c2 > 25) return '';
    return String.fromCodePoint(BASE + c1) + String.fromCodePoint(BASE + c2);
  }

  // SVG flags via flagcdn.com — emoji approach failed on Windows Chrome,
  // which lacks color glyphs for regional-indicator codepoints. flagcdn
  // serves PNG flags reliably across every OS.
  function flagFor(name) {
    var iso = iso2For(name);
    if (!iso) return '';
    var safe = String(name).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
    var lo = iso.toLowerCase();
    var url = 'https://flagcdn.com/w20/' + lo + '.png';
    var url2x = 'https://flagcdn.com/w40/' + lo + '.png';
    return '<img class="flag" src="' + url + '" srcset="' + url2x + ' 2x"' +
           ' width="20" height="15" loading="lazy" decoding="async"' +
           ' alt="" title="' + safe + '" aria-label="' + safe + '">';
  }

  window.flagFor = flagFor;
  window.flagFor.iso2For = iso2For;       // exposed for tests / debug
  window.flagFor.flagEmoji = flagEmoji;   // exposed for tests / debug
})();
