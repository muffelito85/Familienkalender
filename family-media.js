
/* Family Modern – Profilbilder und Hintergründe */
(function () {
  'use strict';

  const ids = {
    daniel: 'b0807984-7383-4a8b-9ae8-8d7a05375056',
    caro: '51fa4afb-aa64-454e-aa0f-eab60b388b28',
    lara: '9c4a8518-075f-48e1-a05e-55b3ded35ec0'
  };

  const bucket = 'family-media';
  let records = {};
  let generation = 0;
  let previousUser = null;

  const $id = id => document.getElementById(id);

  const current = () =>
    typeof sessionUser !== 'undefined' && sessionUser
      ? sessionUser.id
      : null;

  const key = (subject, kind) =>
    familyId + '/' + subject + '/' +
    (kind === 'avatar' ? 'avatar.jpg' : 'background.jpg');

  function note(text) {
    const el = $id('fmMediaStatus');
    if (el) el.textContent = text || '';
  }

  function allowed(subject) {
    return !!current() && (
      subject === current() ||
      (
        subject === 'mila' &&
        ['admin', 'adult'].includes(userRole)
      )
    );
  }

  async function signed(path) {
    if (!path) return null;

    const result = await sb.storage
      .from(bucket)
      .createSignedUrl(path, 3600);

    return result.error ? null : result.data.signedUrl;
  }

  async function load() {
    if (!sb || !current() || !familyId) return;

    const token = ++generation;
    const who = current();

    const result = await sb
      .from('family_visuals')
      .select('subject,avatar_path,background_path,scene')
      .eq('family_id', familyId);

    if (token !== generation || current() !== who) return;

    if (result.error) {
      note('Bilder konnten nicht geladen werden: ' +
        result.error.message);
      return;
    }

    records = Object.fromEntries(
      (result.data || []).map(x => [x.subject, x])
    );

    updateControls();
    renderPictures(token, who);
  }

  async function renderPictures(token, who) {
    const container = $id('homeAvatars');
    if (!container || !sb || !who) return;

    const portraits =
      container.querySelectorAll('.homeAvatar .portrait');

    const members = ['daniel', 'caro', 'lara', 'mila'];

    for (
      let i = 0;
      i < portraits.length && i < members.length;
      i++
    ) {
      const el = portraits[i];
      const subject = ids[members[i]] || 'mila';
      const path = records[subject]?.avatar_path;

      el.style.backgroundImage = '';
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';

      if (!path) continue;

      const url = await signed(path);

      if (
        token !== generation ||
        current() !== who ||
        !el.isConnected
      ) return;

      if (url) {
        el.style.backgroundImage = `url("${url}")`;
        el.textContent = '';
      }
    }

    const own = records[who] || {};
    const hero = $id('homeHero');

    if (!hero) return;

    const scene = own.scene || 'sunset';

    hero.dataset.scene =
      scene === 'photo' ? 'plain' : scene;

    hero.style.backgroundImage = '';

    if (scene === 'photo' && own.background_path) {
      const url = await signed(own.background_path);

      if (token !== generation || current() !== who) {
        return;
      }

      if (url) {
        hero.style.backgroundImage =
          'linear-gradient(0deg,' +
          'rgba(16,20,38,.50),' +
          'rgba(16,20,38,.20)),' +
          `url("${url}")`;

        hero.style.backgroundSize = 'cover';
        hero.style.backgroundPosition = 'center';
      }
    }
  }

  async function persist(subject, patch) {
    if (!allowed(subject)) {
      throw new Error('Keine Berechtigung.');
    }

    const existing = records[subject] || {};

    const data = {
      family_id: familyId,
      subject,
      avatar_path: existing.avatar_path || null,
      background_path: existing.background_path || null,
      scene: existing.scene || 'sunset',
      ...patch
    };

    const result = await sb
      .from('family_visuals')
      .upsert(data, {
        onConflict: 'family_id,subject'
      });

    if (result.error) throw result.error;

    await load();
  }

  async function compress(file, max = 1280) {
    if (!file || !file.type.startsWith('image/')) {
      throw new Error('Bitte ein Bild auswählen.');
    }

    if (file.size > 12 * 1024 * 1024) {
      throw new Error('Originalbild ist größer als 12 MB.');
    }

    const bitmap = await createImageBitmap(file);

    const scale = Math.min(
      1,
      max / Math.max(bitmap.width, bitmap.height)
    );

    const canvas = document.createElement('canvas');

    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);

    canvas.getContext('2d').drawImage(
      bitmap,
      0,
      0,
      canvas.width,
      canvas.height
    );

    bitmap.close();

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        blob => blob
          ? resolve(blob)
          : reject(new Error('Bildverarbeitung fehlgeschlagen.')),
        'image/jpeg',
        0.84
      );
    });
  }

  async function upload(subject, kind, file) {
    if (!allowed(subject)) {
      throw new Error('Keine Berechtigung.');
    }

    note('Bild wird verarbeitet …');

    const blob = await compress(
      file,
      kind === 'avatar' ? 640 : 1600
    );

    const path = key(subject, kind);

    note('Bild wird hochgeladen …');

    const result = await sb.storage
      .from(bucket)
      .upload(path, blob, {
        upsert: true,
        contentType: 'image/jpeg',
        cacheControl: '60'
      });

    if (result.error) throw result.error;

    await persist(subject, {
      [kind === 'avatar'
        ? 'avatar_path'
        : 'background_path']: path,
      ...(kind === 'background'
        ? { scene: 'photo' }
        : {})
    });

    note('Bild gespeichert.');
  }

  function field(label, input) {
    const wrap = document.createElement('label');
    wrap.className = 'fmMediaField';

    const span = document.createElement('span');
    span.textContent = label;

    wrap.append(span, input);
    return wrap;
  }

  function makeFile(subject, kind, label) {
    const input = document.createElement('input');

    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.disabled = !allowed(subject);

    input.addEventListener('change', async () => {
      if (!input.files[0]) return;

      input.disabled = true;

      try {
        await upload(subject, kind, input.files[0]);
      } catch (error) {
        note('Fehler: ' + error.message);
      } finally {
        input.value = '';
        input.disabled = !allowed(subject);
      }
    });

    return field(label, input);
  }

  function updateControls() {
    const own = current();
    const area = $id('fmMediaControls');

    if (!area) return;

    area.replaceChildren();

    if (!own) {
      note('Bitte anmelden.');
      return;
    }

    const title = document.createElement('h2');
    title.textContent = 'Profilbilder & Hintergrund';

    area.appendChild(title);

    area.appendChild(
      makeFile(own, 'avatar', 'Mein Profilbild ändern')
    );

    if (['admin', 'adult'].includes(userRole)) {
      area.appendChild(
        makeFile('mila', 'avatar', 'Milas Profilbild ändern')
      );
    }

    area.appendChild(
      makeFile(
        own,
        'background',
        'Eigenes Hintergrundfoto hochladen'
      )
    );

    const scene = document.createElement('select');

    const choices = [
      ['sunset', 'Abendhimmel'],
      ['ocean', 'Meer'],
      ['forest', 'Natur'],
      ['plain', 'Schlicht'],
      ['photo', 'Eigenes Foto']
    ];

    for (const [value, text] of choices) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      scene.appendChild(option);
    }

    scene.value = records[own]?.scene || 'sunset';

    scene.onchange = async () => {
      try {
        if (
          scene.value === 'photo' &&
          !records[own]?.background_path
        ) {
          throw new Error(
            'Bitte zuerst ein Hintergrundfoto hochladen.'
          );
        }

        await persist(own, {
          scene: scene.value
        });

        note('Hintergrund gespeichert.');
      } catch (error) {
        note('Fehler: ' + error.message);

        scene.value =
          records[own]?.scene || 'sunset';
      }
    };

    area.appendChild(
      field('Mein Startseiten-Hintergrund', scene)
    );

    const help = document.createElement('small');

    help.textContent =
      'Jeder ändert nur eigene Bilder. ' +
      'Milas Bild können Dani und Caro ändern. ' +
      'Die Bilder sind nur für angemeldete ' +
      'Familienmitglieder zugänglich.';

    area.appendChild(help);
  }

  function setup() {
    const more = $id('familyMore');
    if (!more) return;

    const style = document.createElement('style');

    style.textContent = `
      .fmMediaPanel {
        padding: 16px;
        margin: 18px 0;
        border: 1px solid var(--line);
        border-radius: 18px;
        background: var(--card);
      }

      .fmMediaPanel h2 {
        margin: 0 0 12px;
        font-size: 18px;
      }

      .fmMediaField {
        display: flex !important;
        flex-direction: column;
        gap: 6px;
        margin: 12px 0 !important;
        font-size: 13px;
        font-weight: 650;
      }

      .fmMediaField input,
      .fmMediaField select {
        width: 100%;
        max-width: 100%;
        padding: 10px;
        border: 1px solid var(--line);
        border-radius: 10px;
        background: var(--bg);
        color: var(--text);
      }

      #fmMediaStatus {
        font-size: 13px;
        color: var(--muted);
        min-height: 18px;
      }

      .homeHero {
        background-repeat: no-repeat;
      }
    `;

    document.head.appendChild(style);

    const panel = document.createElement('section');
    panel.className = 'fmMediaPanel';

    panel.innerHTML = `
      <div id="fmMediaControls"></div>
      <p id="fmMediaStatus" role="status"></p>
    `;

    const design =
      more.querySelector('.settingsGroupTitle');

    if (design && design.nextSibling) {
      more.insertBefore(panel, design.nextSibling);
    } else {
      more.appendChild(panel);
    }

    const oldHome = homeRender;

    homeRender = function () {
      oldHome();

      if (current()) {
        renderPictures(generation, current());
      }
    };

    const scene = $id('homeScene');

    if (scene) {
      scene.onchange = async function () {
        if (!current()) return;

        try {
          await persist(current(), {
            scene: scene.value
          });
        } catch (error) {
          note('Fehler: ' + error.message);
        }
      };
    }

    setInterval(function () {
      const user = current();

      if (user !== previousUser) {
        previousUser = user;
        records = {};
        generation++;

        updateControls();

        if (user) {
          load();
        } else {
          const hero = $id('homeHero');
          if (hero) hero.style.backgroundImage = '';
        }
      }
    }, 1200);

    document.addEventListener(
      'visibilitychange',
      () => {
        if (!document.hidden && current()) {
          load();
        }
      }
    );

    updateControls();

    if (current()) load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      setup
    );
  } else {
    setup();
  }
})();

