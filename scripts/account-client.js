    const account = {
      ready: !(authConfig.url && authConfig.anon),
      user: null,
      profile: { handle: '', homeCity: '' },
      venues: [],
      cities: [],
      reviews: [],
      alerts: [],
      visits: [],
    };
    let pendingSave = null;
    let authClient = null;
    let signing = false;
    let welcomed = false;
    let accountView = 'menu';
    let authMode = 'in';
    let toastTimer = 0;
    let googleReady = false;
    const loadedScripts = {};

    function loadScript(src) {
      if (loadedScripts[src]) return loadedScripts[src];
      loadedScripts[src] = new Promise((resolve, reject) => {
        const node = document.createElement('script');
        node.src = src;
        node.onload = () => resolve();
        node.onerror = () => reject(new Error(src));
        document.head.append(node);
      });
      return loadedScripts[src];
    }

    function toast(text) {
      const node = document.getElementById('toast');
      node.textContent = text;
      node.hidden = false;
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => { node.hidden = true; }, 2400);
    }

    function welcome() {
      if (welcomed) return;
      welcomed = true;
      toast('Welcome back.');
      closeAccount();
    }

    function clearLocal() {
      account.user = null;
      account.profile = { handle: '', homeCity: '' };
      account.venues = [];
      account.cities = [];
      account.reviews = [];
      account.alerts = [];
      account.visits = [];
    }

    function venueRecord(id) {
      for (let i = 0; i < tonight.cities.length; i += 1) {
        const city = tonight.cities[i];
        const venue = city.venues.find((item) => item.id === id);
        if (venue) return { venue: venue, city: city };
      }
      return null;
    }

    function cityRecord(id) {
      return tonight.cities.find((city) => city.id === id) || null;
    }

    function paintForYou() {
      const section = document.getElementById('for-you');
      const city = homeCity();
      const hour = activeHour(city);
      const venues = account.venues.map((id) => city.venues.find((venue) => venue.id === id)).filter(Boolean);
      venues.sort((a, b) => b.curve[hour] - a.curve[hour]);
      if (!venues.length) {
        section.hidden = true;
        return;
      }
      section.hidden = false;
      fillRail(document.getElementById('for-you-list'), venues, (venue) => ({
        percent: venue.curve[hour],
        note: busyNote(venue),
        line: venue.unsure ? 'Hours not confirmed · peaks ~' + peakText(venue.peak) : 'Open now · peaks ~' + peakText(venue.peak),
      }), true);
    }

    function paintAccountChrome() {
      const pending = !account.ready;
      const logged = Boolean(account.user);
      document.getElementById('auth-skel').hidden = !pending;
      document.getElementById('auth-skel-wide').hidden = !pending;
      document.getElementById('login-btn').hidden = pending || logged;
      document.getElementById('signup-btn').hidden = pending || logged;
      document.getElementById('foot-login').hidden = logged;
      document.getElementById('foot-signup').hidden = logged;
      paintForYou();
      const picker = document.getElementById('city-picker');
      if (picker && !picker.hidden) renderPicker();
      const back = document.getElementById('account-back');
      if (back && !back.hidden) paintAccountPanel();
    }

    function setAuthError(text) {
      const node = document.querySelector('#account-body .auth-error');
      if (!node) {
        if (text) toast(text);
        return;
      }
      node.hidden = !text;
      node.textContent = text || '';
    }

    function menuList(items) {
      const list = document.createElement('ul');
      list.className = 'account-menu';
      items.forEach((item) => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = item.label;
        button.addEventListener('click', item.onClick);
        li.append(button);
        list.append(li);
      });
      return list;
    }

    function backButton() {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sheet-save';
      button.textContent = 'Back';
      button.addEventListener('click', () => showAccount('menu'));
      return button;
    }

    function paintAccountPanel() {
      const body = document.getElementById('account-body');
      const sheet = document.getElementById('account-sheet');
      body.replaceChildren();
      if (!account.ready) {
        sheet.setAttribute('aria-label', 'Account');
        for (let i = 0; i < 3; i += 1) {
          const bar = document.createElement('span');
          bar.className = 'auth-skel is-wide';
          bar.style.display = 'block';
          bar.style.width = '100%';
          bar.style.marginTop = '0.75rem';
          body.append(bar);
        }
        return;
      }
      if (accountView === 'auth') {
        paintAuth(body, sheet);
        return;
      }
      if (accountView === 'profile') {
        paintProfile(body, sheet);
        return;
      }
      if (accountView === 'favorites') {
        paintFavorites(body, sheet);
        return;
      }
      if (accountView === 'reviews') {
        paintReviews(body, sheet);
        return;
      }
      if (accountView === 'rewards') {
        paintRewards(body, sheet);
        return;
      }
      if (accountView === 'delete') {
        paintDelete(body, sheet);
        return;
      }
      sheet.setAttribute('aria-label', 'Account');
      const title = document.createElement('h3');
      title.textContent = account.user ? 'Account' : 'Account';
      body.append(title);
      if (!account.user) {
        body.append(menuList([
          { label: 'Sign in', onClick: () => showAccount('auth', 'in') },
          { label: 'Create account', onClick: () => showAccount('auth', 'up') },
        ]));
        return;
      }
      const who = document.createElement('p');
      who.className = 'auth-note';
      who.textContent = account.user.email || '';
      body.append(who);
      body.append(menuList([
        { label: 'My Profile', onClick: () => showAccount('profile') },
        { label: 'My Favorites', onClick: () => showAccount('favorites') },
        { label: 'My Reviews', onClick: () => showAccount('reviews') },
        { label: 'Rewards', onClick: () => showAccount('rewards') },
        { label: 'Delete Account', onClick: () => showAccount('delete') },
        { label: 'Sign out', onClick: () => signOut() },
      ]));
    }

    function paintAuth(body, sheet) {
      sheet.setAttribute('aria-label', authMode === 'up' ? 'Create account' : 'Sign in');
      const title = document.createElement('h3');
      title.textContent = authMode === 'up' ? 'Create account' : 'Sign in';
      body.append(title);
      if (pendingSave) {
        const prompt = document.createElement('p');
        prompt.className = 'auth-prompt';
        prompt.textContent = pendingSave.kind === 'city' ? 'Save this city → sign in' : 'Save this venue → sign in';
        body.append(prompt);
      }
      const slot = document.createElement('div');
      slot.className = 'google-slot';
      slot.id = 'google-slot';
      const google = document.createElement('button');
      google.type = 'button';
      google.className = 'auth-google';
      google.textContent = 'Continue with Google';
      google.addEventListener('click', continueGoogle);
      const apple = document.createElement('button');
      apple.type = 'button';
      apple.className = 'auth-apple';
      apple.textContent = 'Sign in with Apple';
      apple.addEventListener('click', continueApple);
      const email = document.createElement('input');
      email.type = 'email';
      email.className = 'account-field';
      email.placeholder = 'Email';
      email.autocomplete = 'email';
      email.setAttribute('inputmode', 'email');
      const send = document.createElement('button');
      send.type = 'button';
      send.className = 'auth-send';
      send.textContent = 'Email me a link';
      const status = document.createElement('p');
      status.className = 'auth-error';
      status.hidden = true;
      send.addEventListener('click', () => sendMagicLink(email.value));
      const note = document.createElement('p');
      note.className = 'auth-note';
      note.textContent = 'We store your sign-in, saved places, and reviews. A handle is enough, and a real name is never required. Apple can hide your email.';
      body.append(slot, google, apple, email, send, status, note);
      mountGoogle(slot, google);
      window.setTimeout(() => email.focus(), 0);
    }

    function paintProfile(body, sheet) {
      sheet.setAttribute('aria-label', 'My Profile');
      body.append(backButton());
      const title = document.createElement('h3');
      title.textContent = 'My Profile';
      const handle = document.createElement('input');
      handle.type = 'text';
      handle.className = 'account-field';
      handle.placeholder = 'Handle';
      handle.maxLength = 40;
      handle.autocomplete = 'nickname';
      handle.value = account.profile.handle || '';
      const city = document.createElement('select');
      city.className = 'account-field';
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = 'Home city';
      city.append(blank);
      tonight.cities.slice().sort((a, b) => a.name.localeCompare(b.name, 'en')).forEach((item) => {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.name;
        city.append(option);
      });
      city.value = account.profile.homeCity || '';
      body.append(title, handle, city);
      const checks = [];
      account.cities.forEach((id) => {
        const record = cityRecord(id);
        checks.push(alertRow('city', id, record ? record.name : id));
      });
      account.venues.forEach((id) => {
        const record = venueRecord(id);
        checks.push(alertRow('venue', id, record ? record.venue.name : id));
      });
      checks.forEach((row) => body.append(row));
      const status = document.createElement('p');
      status.className = 'auth-error';
      status.hidden = true;
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'auth-send';
      save.textContent = 'Save';
      save.addEventListener('click', () => saveProfile(handle.value, city.value, checks, status));
      body.append(status, save);
    }

    function alertRow(scope, ref, label) {
      const row = document.createElement('label');
      row.className = 'account-check';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = account.alerts.some((item) => item.scope === scope && item.ref === ref);
      const text = document.createElement('span');
      text.textContent = 'Forecast alert for ' + label;
      row.append(box, text);
      row.dataset.scope = scope;
      row.dataset.ref = ref;
      return row;
    }

    function paintFavorites(body, sheet) {
      sheet.setAttribute('aria-label', 'My Favorites');
      body.append(backButton());
      const title = document.createElement('h3');
      title.textContent = 'My Favorites';
      body.append(title);
      const rows = [];
      account.cities.forEach((id) => {
        const record = cityRecord(id);
        rows.push({ kind: 'city', id: id, label: record ? record.name : id });
      });
      account.venues.forEach((id) => {
        const record = venueRecord(id);
        rows.push({ kind: 'venue', id: id, label: record ? record.venue.name : id });
      });
      if (!rows.length) {
        const empty = document.createElement('p');
        empty.className = 'account-empty';
        empty.textContent = 'Save a venue from its page, or a city from the city list.';
        body.append(empty);
        return;
      }
      rows.forEach((row) => {
        const line = document.createElement('p');
        line.className = 'account-check';
        const name = document.createElement('span');
        name.textContent = row.label;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'city-pin';
        remove.textContent = 'Remove';
        remove.addEventListener('click', () => {
          if (row.kind === 'city') saveCity(row.id);
          else toggleVenue(row.id);
        });
        line.append(name, remove);
        body.append(line);
      });
    }

    function paintReviews(body, sheet) {
      sheet.setAttribute('aria-label', 'My Reviews');
      body.append(backButton());
      const title = document.createElement('h3');
      title.textContent = 'My Reviews';
      body.append(title);
      const reviews = account.reviews.slice().sort((a, b) => (a.at < b.at ? 1 : -1));
      if (!reviews.length) {
        const empty = document.createElement('p');
        empty.className = 'account-empty';
        empty.textContent = 'Reviews you write on a venue show up here.';
        body.append(empty);
        return;
      }
      reviews.forEach((review) => {
        const record = venueRecord(review.venueId);
        const block = document.createElement('article');
        const name = document.createElement('p');
        name.className = 'tonight-name';
        name.textContent = record ? record.venue.name : review.venueId;
        const when = document.createElement('p');
        when.className = 'auth-note';
        when.textContent = review.at ? review.at.slice(0, 10) : '';
        const copy = document.createElement('p');
        copy.textContent = review.body;
        block.append(name, when, copy);
        body.append(block);
      });
    }

    function paintRewards(body, sheet) {
      sheet.setAttribute('aria-label', 'Rewards');
      body.append(backButton());
      const title = document.createElement('h3');
      title.textContent = 'Rewards';
      const points = account.visits.reduce((sum, visit) => sum + (visit.points || 1), 0);
      const total = document.createElement('p');
      total.className = 'rank-note';
      total.textContent = points + (points === 1 ? ' point' : ' points');
      body.append(title, total);
      const visits = account.visits.slice().sort((a, b) => (a.on < b.on ? 1 : -1));
      visits.forEach((visit) => {
        const record = venueRecord(visit.venueId);
        const line = document.createElement('p');
        line.textContent = (record ? record.venue.name : visit.venueId) + ' · ' + (visit.on || '');
        body.append(line);
      });
    }

    function paintDelete(body, sheet) {
      sheet.setAttribute('aria-label', 'Delete Account');
      body.append(backButton());
      const title = document.createElement('h3');
      title.textContent = 'Delete Account';
      const copy = document.createElement('p');
      copy.textContent = 'Delete your account and everything saved with it?';
      const status = document.createElement('p');
      status.className = 'auth-error';
      status.hidden = true;
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'auth-send';
      confirm.textContent = 'Delete account';
      confirm.addEventListener('click', () => deleteAccount(status));
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'auth-google';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => showAccount('menu'));
      body.append(title, copy, status, confirm, cancel);
    }

    function showAccount(panel, mode) {
      if (mode) authMode = mode;
      accountView = panel;
      const body = document.getElementById('account-body');
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) {
        paintAccountPanel();
        return;
      }
      body.classList.add('is-out');
      window.setTimeout(() => {
        paintAccountPanel();
        body.classList.remove('is-out');
      }, 180);
    }

    function openAccount(panel, mode) {
      accountView = panel || 'menu';
      if (mode) authMode = mode;
      const back = document.getElementById('account-back');
      back.hidden = false;
      paintAccountPanel();
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) back.classList.add('is-on');
      else requestAnimationFrame(() => back.classList.add('is-on'));
    }

    function closeAccount() {
      const back = document.getElementById('account-back');
      if (!back || back.hidden) return;
      back.classList.remove('is-on');
      const finish = () => { back.hidden = true; };
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
      else window.setTimeout(finish, 200);
    }

    function toggleVenue(id) {
      const index = account.venues.indexOf(id);
      const on = index === -1;
      if (on) account.venues.push(id);
      else account.venues.splice(index, 1);
      syncFavorite('venue', id, on);
      paintAccountChrome();
    }

    function saveCity(id) {
      if (!account.user) {
        pendingSave = { kind: 'city', id: id };
        openAccount('auth', 'in');
        return;
      }
      if (account.profile.homeCity === id && account.cities.indexOf(id) === -1) return;
      const index = account.cities.indexOf(id);
      const on = index === -1;
      if (on) account.cities.push(id);
      else account.cities.splice(index, 1);
      syncFavorite('city', id, on);
      paintAccountChrome();
    }

    function syncFavorite(kind, ref, on) {
      if (!authClient || !account.user) return;
      const write = on
        ? authClient.from('favorites').upsert({ user_id: account.user.id, kind: kind, ref: ref })
        : authClient.from('favorites').delete().eq('user_id', account.user.id).eq('kind', kind).eq('ref', ref);
      write.then(({ error }) => { if (error) toast(error.message); });
    }

    function saveReview(venueId, value) {
      const body = value.trim();
      if (!body || !account.user) return;
      const review = { venueId: venueId, body: body, at: new Date().toISOString() };
      account.reviews.unshift(review);
      if (authClient) {
        authClient.from('reviews').insert({ user_id: account.user.id, venue_id: venueId, body: body }).then(({ error }) => {
          if (error) toast(error.message);
        });
      }
      toast('Review saved.');
    }

    function logVisit(venueId) {
      if (!account.user) return;
      const visit = { venueId: venueId, on: new Date().toISOString().slice(0, 10), points: 1 };
      account.visits.unshift(visit);
      if (authClient) {
        authClient.from('reward_visits').insert({ user_id: account.user.id, venue_id: venueId, points: 1 }).then(({ error }) => {
          if (error) toast(error.message);
        });
      }
      toast('Visit logged.');
    }

    function saveProfile(handle, homeCity, checks, status) {
      account.profile.handle = handle.trim();
      account.profile.homeCity = homeCity;
      account.alerts = checks.filter((row) => row.querySelector('input').checked).map((row) => ({
        scope: row.dataset.scope,
        ref: row.dataset.ref,
      }));
      if (!authClient || !account.user) {
        paintAccountChrome();
        showAccount('menu');
        return;
      }
      const uid = account.user.id;
      authClient.from('profiles').upsert({ user_id: uid, handle: account.profile.handle, home_city: account.profile.homeCity }).then(({ error }) => {
        if (error) {
          status.hidden = false;
          status.textContent = error.message;
          return;
        }
        authClient.from('alert_prefs').delete().eq('user_id', uid).then(() => {
          if (!account.alerts.length) {
            showAccount('menu');
            return;
          }
          authClient.from('alert_prefs').insert(account.alerts.map((item) => ({
            user_id: uid,
            scope: item.scope,
            ref: item.ref,
            enabled: true,
          }))).then(({ error: alertError }) => {
            if (alertError) {
              status.hidden = false;
              status.textContent = alertError.message;
              return;
            }
            showAccount('menu');
          });
        });
      });
      paintAccountChrome();
    }

    function deleteAccount(status) {
      const finish = () => {
        clearLocal();
        pendingSave = null;
        closeAccount();
        paintAccountChrome();
        paintHome();
      };
      if (!authClient) {
        finish();
        return;
      }
      authClient.rpc('delete_my_account').then(({ error }) => {
        if (error) {
          status.hidden = false;
          status.textContent = error.message;
          return;
        }
        authClient.auth.signOut().then(finish);
      });
    }

    function signOut() {
      if (authClient) {
        authClient.auth.signOut();
        return;
      }
      clearLocal();
      closeAccount();
      paintAccountChrome();
      paintHome();
    }

    function absorbLegacy() {
      let legacy = [];
      try { legacy = JSON.parse(localStorage.getItem('fd-saved') || '[]'); } catch (err) { legacy = []; }
      if (!Array.isArray(legacy)) return;
      legacy.forEach((id) => {
        if (account.venues.indexOf(id) === -1 && venueRecord(id)) {
          account.venues.push(id);
          syncFavorite('venue', id, true);
        }
      });
      if (legacy.length) localStorage.removeItem('fd-saved');
    }

    function applyPending() {
      if (!pendingSave || !account.user) return;
      if (pendingSave.kind === 'city') {
        if (account.cities.indexOf(pendingSave.id) === -1) {
          account.cities.push(pendingSave.id);
          syncFavorite('city', pendingSave.id, true);
        }
      } else if (account.venues.indexOf(pendingSave.id) === -1) {
        account.venues.push(pendingSave.id);
        syncFavorite('venue', pendingSave.id, true);
      }
      pendingSave = null;
    }

    function pullAccount() {
      const uid = account.user.id;
      return Promise.all([
        authClient.from('profiles').select('handle, home_city').eq('user_id', uid).maybeSingle(),
        authClient.from('favorites').select('kind, ref, created_at').eq('user_id', uid).order('created_at'),
        authClient.from('reviews').select('venue_id, body, created_at').eq('user_id', uid).order('created_at', { ascending: false }),
        authClient.from('alert_prefs').select('scope, ref, enabled').eq('user_id', uid),
        authClient.from('reward_visits').select('venue_id, visited_on, points').eq('user_id', uid).order('visited_on', { ascending: false }),
      ]).then((rows) => {
        const profile = rows[0].data;
        if (profile) account.profile = { handle: profile.handle || '', homeCity: profile.home_city || '' };
        account.venues = (rows[1].data || []).filter((row) => row.kind === 'venue').map((row) => row.ref);
        account.cities = (rows[1].data || []).filter((row) => row.kind === 'city').map((row) => row.ref);
        account.reviews = (rows[2].data || []).map((row) => ({ venueId: row.venue_id, body: row.body, at: row.created_at }));
        account.alerts = (rows[3].data || []).filter((row) => row.enabled).map((row) => ({ scope: row.scope, ref: row.ref }));
        account.visits = (rows[4].data || []).map((row) => ({ venueId: row.venue_id, on: row.visited_on, points: row.points }));
      }).catch(() => {});
    }

    function applySession(session) {
      account.user = { id: session.user.id, email: session.user.email || '' };
      account.ready = true;
      const loaded = authClient ? pullAccount() : Promise.resolve();
      return loaded.then(() => {
        absorbLegacy();
        applyPending();
        paintAccountChrome();
        paintHome();
      });
    }

    function appleNonce() {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      const raw = Array.from(bytes).map((item) => item.toString(16).padStart(2, '0')).join('');
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)).then((digest) => ({
        raw: raw,
        hashed: Array.from(new Uint8Array(digest)).map((item) => item.toString(16).padStart(2, '0')).join(''),
      }));
    }

    function ensureGoogle() {
      if (googleReady || !authConfig.google || !window.google) return;
      google.accounts.id.initialize({
        client_id: authConfig.google,
        callback: (response) => {
          if (!authClient) return;
          signing = true;
          authClient.auth.signInWithIdToken({ provider: 'google', token: response.credential }).then(({ error }) => {
            if (error) {
              signing = false;
              setAuthError(error.message);
            }
          });
        },
        use_fedcm_for_prompt: true,
        auto_select: false,
        cancel_on_tap_outside: false,
      });
      googleReady = true;
    }

    function mountGoogle(slot, fallback) {
      if (!authConfig.google || !window.google || !google.accounts) return;
      ensureGoogle();
      google.accounts.id.renderButton(slot, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'pill',
        width: 320,
      });
      if (slot.childNodes.length) fallback.hidden = true;
      google.accounts.id.prompt();
    }

    function continueGoogle() {
      if (!authClient || !authConfig.google) {
        setAuthError('Google sign-in is not connected on this copy.');
        return;
      }
      loadScript('https://accounts.google.com/gsi/client').then(() => {
        ensureGoogle();
        google.accounts.id.prompt();
      }).catch(() => setAuthError('Google sign-in did not finish.'));
    }

    function continueApple() {
      if (!authClient || !authConfig.apple) {
        setAuthError('Apple sign-in is not connected on this copy.');
        return;
      }
      Promise.all([
        appleNonce(),
        loadScript('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js'),
      ]).then((parts) => {
        const nonce = parts[0];
        AppleID.auth.init({
          clientId: authConfig.apple,
          scope: 'email',
          redirectURI: location.origin + location.pathname,
          usePopup: true,
          nonce: nonce.hashed,
        });
        signing = true;
        return AppleID.auth.signIn().then((result) => authClient.auth.signInWithIdToken({
          provider: 'apple',
          token: result.authorization.id_token,
          nonce: nonce.raw,
        })).then(({ error }) => {
          if (error) {
            signing = false;
            setAuthError(error.message);
          }
        });
      }).catch((err) => {
        signing = false;
        if (err && err.error === 'popup_closed_by_user') return;
        setAuthError('Apple sign-in did not finish.');
      });
    }

    function sendMagicLink(value) {
      const email = value.trim();
      if (email.indexOf('@') < 1) {
        setAuthError('Enter the email for the link.');
        return;
      }
      if (!authClient) {
        setAuthError('Email sign-in is not connected on this copy.');
        return;
      }
      signing = true;
      authClient.auth.signInWithOtp({
        email: email,
        options: { emailRedirectTo: location.origin + location.pathname },
      }).then(({ error }) => {
        if (error) {
          signing = false;
          setAuthError(error.message);
          return;
        }
        setAuthError('Check your email for a sign-in link.');
      });
    }

    function bootAuth() {
      paintAccountChrome();
      const buttons = [
        ['profile-btn', () => openAccount('menu')],
        ['login-btn', () => openAccount('auth', 'in')],
        ['signup-btn', () => openAccount('auth', 'up')],
      ];
      buttons.forEach((pair) => {
        document.getElementById(pair[0]).addEventListener('click', pair[1]);
      });
      document.getElementById('foot-login').addEventListener('click', (event) => {
        event.preventDefault();
        openAccount('auth', 'in');
      });
      document.getElementById('foot-signup').addEventListener('click', (event) => {
        event.preventDefault();
        openAccount('auth', 'up');
      });
      document.getElementById('account-back').addEventListener('click', (event) => {
        if (event.target.id === 'account-back') closeAccount();
      });
      const handle = document.getElementById('account-handle');
      let dragStart = 0;
      handle.addEventListener('pointerdown', (event) => {
        dragStart = event.clientY;
        handle.setPointerCapture(event.pointerId);
      });
      handle.addEventListener('pointerup', (event) => {
        if (event.clientY - dragStart > 72) closeAccount();
      });
      if (!authConfig.url || !authConfig.anon) return;
      const arrived = location.hash.indexOf('access_token') !== -1 || location.search.indexOf('code=') !== -1;
      account.ready = false;
      paintAccountChrome();
      import('https://esm.sh/@supabase/supabase-js@2.49.1').then((mod) => {
        authClient = mod.createClient(authConfig.url, authConfig.anon, {
          auth: { detectSessionInUrl: true, flowType: 'pkce', persistSession: true },
        });
        authClient.auth.onAuthStateChange((event, session) => {
          if (event === 'SIGNED_OUT') {
            clearLocal();
            account.ready = true;
            closeAccount();
            paintAccountChrome();
            paintHome();
          }
          if (event === 'SIGNED_IN' && session && signing) {
            signing = false;
            applySession(session).then(welcome);
          }
        });
        if (authConfig.google) {
          loadScript('https://accounts.google.com/gsi/client').then(() => ensureGoogle()).catch(() => {});
        }
        return authClient.auth.getSession();
      }).then((result) => {
        if (!result) return;
        const session = result.data && result.data.session;
        if (session) applySession(session).then(() => { if (arrived) welcome(); });
        else {
          account.ready = true;
          paintAccountChrome();
        }
        if (arrived) {
          const url = new URL(location.href);
          url.searchParams.delete('code');
          if (url.hash.indexOf('access_token') !== -1) url.hash = '';
          history.replaceState(null, '', url.pathname + url.search + url.hash);
        }
      }).catch(() => {
        account.ready = true;
        paintAccountChrome();
      });
    }

    bootAuth();
