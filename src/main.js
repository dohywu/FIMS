console.log('✅ main.js loaded');
import './style.css';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  Timestamp,
  getDoc,
  updateDoc,
  getDocs,
  setDoc,
} from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

// ✅ Firebase 설정 (.env)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

let app, auth, db, functions;
let currentUser = null;
let storageFilter = null; // 'RF' | 'FR' | 'CC' | null
let aiSuggestedOnce = false; // ✅ AI 추천 중복 방지

// History cache for per-row UNDO
window._histCache = [];

/* ===============================
   UNDO Snackbar Utilities
   =============================== */
function ensureSnackbarRoot() {
  let root = document.getElementById('snackbar-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'snackbar-root';
    root.className = 'fixed top-3 left-1/2 -translate-x-1/2 z-50 space-y-2';
    document.body.appendChild(root);
  }
  return root;
}

/**
 * showUndoSnackbar
 * @param {string} message
 * @param {() => Promise<void>|void} onUndo
 * @param {number} ttlMs
 */
function showUndoSnackbar(message, onUndo, ttlMs = 10000) {
  const root = ensureSnackbarRoot();
  const wrap = document.createElement('div');
  wrap.className =
    'max-w-[92vw] bg-gray-900 text-white text-sm rounded shadow px-3 py-2 flex items-center gap-3';

  const msg = document.createElement('div');
  msg.textContent = message;

  const undoBtn = document.createElement('button');
  undoBtn.textContent = 'UNDO';
  undoBtn.className =
    'ml-auto bg-white text-gray-900 px-2 py-1 rounded text-xs hover:bg-gray-100';

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    wrap.remove();
  };

  let undone = false;
  undoBtn.onclick = async () => {
    if (undone) return;
    undone = true;
    try {
      const ret = onUndo?.();
      if (ret && typeof ret.then === 'function') await ret;
    } catch (e) {
      console.error('UNDO failed:', e);
    } finally {
      close();
    }
  };

  wrap.appendChild(msg);
  wrap.appendChild(undoBtn);
  root.appendChild(wrap);

  setTimeout(close, ttlMs);
}

// Generic toast (info/error) using the same snackbar root
function showToast(message, type = 'info', ttlMs = 7000) {
  const root = ensureSnackbarRoot();
  const wrap = document.createElement('div');
  wrap.className =
    'max-w-[92vw] ' +
    (type === 'error' ? 'bg-red-600 text-white' : 'bg-gray-900 text-white') +
    ' text-sm rounded shadow px-3 py-2 flex items-center gap-3';

  const msg = document.createElement('div');
  msg.textContent = message;

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'CLOSE';
  closeBtn.className =
    'ml-auto bg-white/90 text-gray-900 px-2 py-1 rounded text-xs hover:bg-white';

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    wrap.remove();
  };
  closeBtn.onclick = close;

  wrap.appendChild(msg);
  wrap.appendChild(closeBtn);
  root.appendChild(wrap);
  setTimeout(close, ttlMs);
}

// stringify helper
function formatError(err, fallback = 'Unexpected error') {
  if (!err) return fallback;
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return fallback;
  }
}

// Global error surfaces → toast
window.addEventListener('error', (ev) => {
  try {
    showToast(`Error: ${formatError(ev.error || ev.message)}`, 'error', 8000);
  } catch {}
});
window.addEventListener('unhandledrejection', (ev) => {
  try {
    showToast(`Error: ${formatError(ev.reason)}`, 'error', 8000);
  } catch {}
});

// ===== Safety helpers for restoring from history (timestamps & merge-safe) =====
function toTimestampMaybe(exp) {
  if (exp?.toDate) return exp; // already a Firestore Timestamp
  if (
    exp &&
    typeof exp.seconds === 'number' &&
    typeof exp.nanoseconds === 'number'
  ) {
    return new Timestamp(exp.seconds, exp.nanoseconds);
  }
  if (typeof exp === 'string') {
    const d = new Date(exp);
    if (!isNaN(d)) return Timestamp.fromDate(d);
  }
  return Timestamp.fromDate(new Date());
}

function sanitizeSnapshot(raw) {
  if (!raw || typeof raw !== 'object') return {};
  return {
    name: raw.name ?? 'UNKNOWN',
    qty: typeof raw.qty === 'number' ? raw.qty : 1,
    storage: raw.storage ?? 'RF',
    expiry: toTimestampMaybe(raw.expiry ?? raw.isoDate ?? raw.expiryISO),
  };
}

async function restoreDocMerge(ref, snapshotLike) {
  const safe = sanitizeSnapshot(snapshotLike);
  await setDoc(ref, safe, { merge: true });
}

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  functions = getFunctions(app);
} catch (error) {
  console.error('❌ Firebase initialization error:', error);
  showToast(`Firebase init failed: ${formatError(error)}`, 'error');
}

// ===============================
// Responsive frame (모바일=카드, 데스크탑=리스트)
// ===============================
function applyResponsiveFrame() {
  try {
    const mainEl = document.querySelector('main');
    if (mainEl) {
      mainEl.classList.remove('flex', 'items-start', 'justify-center');
      mainEl.classList.add('block', 'w-full', 'p-3', 'md:p-6', 'xl:p-8');
      mainEl.style.maxWidth = '100%';
    }

    const outer = document.querySelector('main > div');
    if (outer) {
      // stretch to very wide on desktop while still centered
      outer.classList.add('w-full', 'mx-auto', 'px-3', 'md:px-6', 'xl:px-10');
      outer.classList.add('max-w-screen-2xl');
      outer.style.maxWidth = '1536px';
      outer.style.width = '100%';
    }

    const appEl = document.getElementById('app');
    if (appEl) {
      appEl.classList.add('w-full');
      appEl.style.maxWidth = 'none';
    }

    const inv = document.getElementById('inventory');
    if (inv) {
      // ✅ 모바일=그리드 카드 / 데스크탑=리스트(divide-y)
      inv.className = '';
      inv.classList.add(
        'grid',
        'grid-cols-1',
        'gap-4', // 기본(모바일~md): 카드 그리드
        'lg:block',
        'lg:divide-y',
        'lg:divide-gray-200' // lg~: 리스트
      );
      inv.style.width = '100%';
    }
  } catch (e) {
    console.warn('applyResponsiveFrame error:', e);
  }
}

// Apply once on load and on resize
window.addEventListener('resize', applyResponsiveFrame);
setTimeout(applyResponsiveFrame, 0);

/* ===============================
   공통: 로그인/로그아웃 UI
   =============================== */
function updateAuthUI(user) {
  const loginSection = document.getElementById('login-section');
  if (user) {
    loginSection.innerHTML = `
      <div class="flex items-center gap-4">
        <span class="text-gray-700 text-sm"> Logged in as ${
          user.displayName || 'USER'
        }</span>
        <button id="logout-btn" class="bg-red-500 text-white px-3 py-1 rounded text-sm hover:bg-red-600 transition">LOG OUT</button>
      </div>
    `;
    document
      .getElementById('logout-btn')
      .addEventListener('click', async () => {
        try {
          await signOut(auth);
        } catch (err) {
          console.error('❌ Logout error:', err);
        }
      });
  } else {
    loginSection.innerHTML = `
      <button id="login-btn" class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 transition">
        SIGN IN (Google)
      </button>
    `;
    document.getElementById('login-btn').addEventListener('click', async () => {
      const provider = new GoogleAuthProvider();
      try {
        await signInWithPopup(auth, provider);
      } catch (err) {
        console.error('❌ Login error:', err);
      }
    });
  }
}

// 로그인 상태 감지
onAuthStateChanged(auth, (user) => {
  currentUser = user;
  document.getElementById('app').style.display = user ? 'block' : 'none';
  updateAuthUI(user);
  if (user) loadIngredients();
  // Ensure responsive frame expands once app becomes visible
  applyResponsiveFrame();
});

/* ===============================
   히스토리 저장 & 즉시 UI 반영
   =============================== */
async function saveHistory(act, itemId, beforeData, afterData) {
  if (!currentUser?.uid) return;

  try {
    const cleanBefore = beforeData
      ? JSON.parse(JSON.stringify(beforeData))
      : null;
    const cleanAfter = afterData ? JSON.parse(JSON.stringify(afterData)) : null;

    let qtyChange;
    if (
      cleanBefore &&
      cleanAfter &&
      typeof cleanBefore.qty === 'number' &&
      typeof cleanAfter.qty === 'number' &&
      cleanBefore.qty !== cleanAfter.qty
    ) {
      qtyChange = `(QTY: ${cleanBefore.qty} → ${cleanAfter.qty})`;
    }

    const data = {
      act,
      itemId,
      beforeData: cleanBefore,
      afterData: cleanAfter,
      ts: Timestamp.now(),
      user: currentUser.displayName || currentUser.email || 'ANON',
      ...(qtyChange ? { qtyChange } : {}),
    };

    await addDoc(collection(db, 'users', currentUser.uid, 'ing_history'), data);
    appendHistoryToUI(data);
  } catch (err) {
    console.error('❌ History save err:', err);
    showToast(`History save failed: ${formatError(err)}`, 'error');
  }
}

function appendHistoryToUI(h) {
  const historyDiv = document.getElementById('history');
  if (!historyDiv) return;

  const entry = document.createElement('div');
  entry.className = 'border-b py-2 text-sm';
  let nameLine = `${h.beforeData?.name || h.afterData?.name || ''}`;
  if (h.qtyChange)
    nameLine += ` <span class="text-blue-600">${h.qtyChange}</span>`;
  entry.innerHTML = `
    <b>[${h.act}]</b> ${nameLine} (${h.user})<br>
    <small>${new Date().toLocaleString()}</small>
  `;
  historyDiv.insertBefore(entry, historyDiv.firstChild);
}

/* ===============================
   Soon Expiring + 목록 렌더
   =============================== */
function loadIngredients() {
  const qRef = query(
    collection(db, 'users', currentUser.uid, 'ingredients'),
    orderBy('expiry')
  );

  onSnapshot(qRef, (snapshot) => {
    const list = document.getElementById('inventory');
    list.innerHTML = '';
    // ❌ 덮어쓰기 제거 (applyResponsiveFrame에서 관리)
    // list.className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-6';

    // Ensure outer frame is widened whenever list renders
    applyResponsiveFrame();

    // Soon Expiring 섹션(항상 초기화)
    let soonExpDiv = document.getElementById('soon-expiring');
    if (!soonExpDiv) {
      soonExpDiv = document.createElement('div');
      soonExpDiv.id = 'soon-expiring';
      soonExpDiv.className =
        'col-span-full mb-4 bg-red-50 md:bg-red-100 border border-red-300 md:border-red-400 rounded-md p-3 md:p-4';
      list.parentNode.insertBefore(soonExpDiv, list);
    }
    let soonExpiringItems = [];
    soonExpDiv.innerHTML = '<b>⚠ Soon Expiring</b><br>';

    // Ensure recovery panel exists (once per session)
    ensureRecoveryPanel();

    const today = new Date();
    const myIngredients = [];

    const coldItems = [];
    const freezeItems = [];
    const ccItems = [];

    snapshot.forEach((docSnap) => {
      const item = docSnap.data();
      if (!item?.name) return;

      // 만료일 처리
      let expiryDate = null;
      if (item.expiry?.toDate) {
        expiryDate = item.expiry.toDate();
      } else if (
        typeof item.expiry === 'string' ||
        typeof item.expiry === 'number' ||
        item.expiry instanceof Date
      ) {
        const d = new Date(item.expiry);
        if (!isNaN(d)) expiryDate = d;
      }

      let isoDate = 'N/A';
      let daysLeft = 99999; // sentinel for unknown
      if (expiryDate && !isNaN(expiryDate)) {
        isoDate = expiryDate.toISOString().split('T')[0];
        daysLeft = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
      }

      // Soon Expiring(3일 이하 남음)
      if (daysLeft !== 99999 && daysLeft <= 3) {
        soonExpiringItems.push(
          `- ${item.name} (${item.qty}) D${
            daysLeft >= 0 ? '-' + daysLeft : '+' + Math.abs(daysLeft)
          }`
        );
      }

      myIngredients.push(item.name);

      const card = `
  <div class="
    inv-card
    bg-white border rounded p-3
    flex flex-col md:flex-row md:items-center md:justify-between gap-3
    lg:bg-transparent lg:border-0 lg:rounded-none lg:px-0 lg:py-2
  ">
    <div class="inv-row flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 w-full">
      
      <!-- LEFT -->
      <div class="inv-left flex items-center gap-2 min-w-0 lg:justify-start">
        <input type="checkbox" class="select-item mt-1" data-id="${docSnap.id}">
        <select onchange="changeStorage('${docSnap.id}', this.value)"
                class="h-8 border rounded px-2 text-xs">
          <option value="RF" ${
            item.storage === 'RF' ? 'selected' : ''
          }>RF</option>
          <option value="FR" ${
            item.storage === 'FR' ? 'selected' : ''
          }>FR</option>
          <option value="CC" ${
            item.storage === 'CC' ? 'selected' : ''
          }>CC</option>
        </select>

        <div class="min-w-0">
          <div class="inv-name text-[15px] leading-tight font-medium text-gray-900 break-words">
            ${item.name} (${item.qty})
          </div>
          <div class="inv-meta text-[11px] text-gray-400 break-all">
            ID: ${docSnap.id}
          </div>
        </div>

        <button
          class="mt-1 inline-block px-2 py-0.5 rounded-full text-[11px] ${
            daysLeft <= 3
              ? 'bg-red-100 text-red-700 font-semibold'
              : 'bg-gray-100 text-gray-700'
          }"
          onclick="showExpiryDate('${item.name.replace(
            /'/g,
            "\\'"
          )}', '${isoDate}')"
        >
          ${
            daysLeft === 99999
              ? 'D—'
              : `D${daysLeft >= 0 ? '-' + daysLeft : '+' + Math.abs(daysLeft)}`
          }
        </button>
      </div>

      <!-- RIGHT -->
      <div class="inv-right flex flex-wrap gap-2 lg:ml-auto lg:self-center lg:justify-end">
        <button class="bg-blue-500 text-white px-3 py-2 rounded text-xs whitespace-nowrap md:min-w-[104px]"
          onclick="editExpiry('${docSnap.id}', '${isoDate}')">EDIT-EXP</button>
        <button class="bg-red-500 text-white px-3 py-2 rounded text-xs whitespace-nowrap md:min-w-[104px]"
          onclick="deleteIngredient('${docSnap.id}')">DEL</button>
        <button class="bg-red-700 text-white px-3 py-2 rounded text-xs whitespace-nowrap md:min-w-[104px]"
          onclick="deleteIngredientAll('${docSnap.id}')">DEL-ALL</button>
      </div>
    </div>
  </div>`;

      // ✅ 필터 적용
      const type = item.storage || 'RF';
      if (!storageFilter || storageFilter === type) {
        if (type === 'RF') coldItems.push(card);
        else if (type === 'FR') freezeItems.push(card);
        else if (type === 'CC') ccItems.push(card);
      }
    });

    // Soon Expiring 출력
    soonExpDiv.innerHTML =
      soonExpiringItems.length > 0
        ? '<b>⚠ Soon Expiring</b><br>' + soonExpiringItems.join('<br>')
        : '<b>⚠ Soon Expiring</b><br><i>None</i>';

    // 목록 출력 (섹션 헤더 유지)
    if (!storageFilter || storageFilter === 'RF') {
      if (coldItems.length)
        list.innerHTML +=
          `<h3 class="col-span-full text-lg font-semibold text-blue-600 mt-2">❄ RF</h3>` +
          coldItems.join('');
    }
    if (!storageFilter || storageFilter === 'FR') {
      if (freezeItems.length)
        list.innerHTML +=
          `<h3 class="col-span-full text-lg font-semibold text-indigo-600 mt-2">🧊 FR</h3>` +
          freezeItems.join('');
    }
    if (!storageFilter || storageFilter === 'CC') {
      if (ccItems.length)
        list.innerHTML +=
          `<h3 class="col-span-full text-lg font-semibold text-orange-600 mt-2">🥶 CC</h3>` +
          ccItems.join('');
    }

    renderRecipes(myIngredients);

    if (!aiSuggestedOnce && myIngredients.length > 0) {
      aiSuggestedOnce = true;
      getAiRecipeSuggestion(myIngredients);
    }
  });
}

// D- 클릭 시 실제 만료일을 알림으로 표시
window.showExpiryDate = function (name, isoDate) {
  if (!isoDate || isoDate === 'N/A') {
    alert(`${name}: no expiry date set.`);
    return;
  }
  alert(`${name} expires on: ${isoDate}`);
};

// ====== Emergency Rescue Panel (floating) ======
function ensureRecoveryPanel() {
  if (document.getElementById('rescue-toggle')) return;

  // Toggle Button
  const btn = document.createElement('button');
  btn.id = 'rescue-toggle';
  btn.className =
    'fixed bottom-4 right-4 z-50 bg-gray-800 text-white text-xs px-3 py-2 rounded shadow hover:bg-black';
  btn.textContent = 'Rescue';
  document.body.appendChild(btn);

  // Panel
  const panel = document.createElement('div');
  panel.id = 'rescue-panel';
  panel.className =
    'hidden fixed bottom-16 right-4 z-50 w-[92vw] max-w-sm bg-white border border-gray-300 rounded shadow p-3 space-y-2';
  panel.innerHTML = `
    <div class="flex items-center justify-between">
      <div class="font-semibold text-sm">Emergency Recovery</div>
      <button id="rescue-close" class="text-xs bg-gray-200 px-2 py-1 rounded hover:bg-gray-300">Close</button>
    </div>

    <div class="space-y-2">
      <div class="grid grid-cols-2 gap-2">
        <button id="rescue-backup-now" class="w-full bg-green-600 text-white text-xs px-3 py-2 rounded hover:bg-green-700">Backup now</button>
        <button id="rescue-list-backups" class="w-full bg-gray-800 text-white text-xs px-3 py-2 rounded hover:bg-black">Show backups</button>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <button id="rescue-restore-latest-backup" class="w-full bg-blue-600 text-white text-xs px-3 py-2 rounded hover:bg-blue-700">Restore latest backup</button>
        <button id="rescue-delete-latest-backup" class="w-full bg-red-600 text-white text-xs px-3 py-2 rounded hover:bg-red-700">Delete latest backup</button>
      </div>
    </div>

    <div class="space-y-1 mt-2">
      <label class="text-xs text-gray-600">Document ID (single-doc tools)</label>
      <input id="rescue-docid" class="w-full border border-gray-300 rounded px-2 py-1 text-xs" placeholder="e.g. a1B2c3D4..." />
    </div>
    <div class="space-y-1">
      <button id="rescue-restore-latest" class="w-full bg-blue-500 text-white text-xs px-3 py-2 rounded hover:bg-blue-600">Restore latest snapshot (single doc)</button>
    </div>
    <div class="space-y-1">
      <label class="text-xs text-gray-600">Force merge JSON snapshot (optional)</label>
      <textarea id="rescue-json" class="w-full h-24 border border-gray-300 rounded px-2 py-1 text-xs" placeholder='{"name":"...", "qty":1, "storage":"RF", "expiry":"2025-01-01"}'></textarea>
      <button id="rescue-merge-json" class="w-full bg-gray-800 text-white text-xs px-3 py-2 rounded hover:bg-black">Force merge JSON → Doc</button>
    </div>

    <div class="mt-2">
      <div class="font-semibold text-xs text-gray-700 mb-1">Backups</div>
      <div id="rescue-backup-list" class="max-h-56 overflow-auto space-y-1 text-xs"></div>
    </div>

    <div class="text-[10px] text-gray-500 mt-1">
      Tip: Full backups are stored under /users/&lt;uid&gt;/ing_backups. Restore replaces current list to the snapshot state.
    </div>
  `;
  document.body.appendChild(panel);

  btn.addEventListener('click', () => {
    panel.classList.toggle('hidden');
  });
  panel.querySelector('#rescue-close').addEventListener('click', () => {
    panel.classList.add('hidden');
  });

  // Full backup handlers
  panel
    .querySelector('#rescue-backup-now')
    .addEventListener('click', async () => {
      try {
        await window.backupNow();
        showToast('Backup completed.');
      } catch (e) {
        showToast(`Backup failed: ${formatError(e)}`, 'error');
      }
    });
  panel
    .querySelector('#rescue-list-backups')
    .addEventListener('click', async () => {
      try {
        await window.listBackups();
        showToast('Backups refreshed.');
      } catch (e) {
        showToast(`List failed: ${formatError(e)}`, 'error');
      }
    });
  panel
    .querySelector('#rescue-restore-latest-backup')
    .addEventListener('click', async () => {
      const ok = confirm(
        'Restore latest full backup? This will replace current items.'
      );
      if (!ok) return;
      try {
        await window.restoreLatestBackup();
        showToast('Restore started.');
      } catch (e) {
        showToast(`Restore failed: ${formatError(e)}`, 'error');
      }
    });
  panel
    .querySelector('#rescue-delete-latest-backup')
    .addEventListener('click', async () => {
      const ok = confirm('Delete latest backup permanently?');
      if (!ok) return;
      try {
        await window.deleteLatestBackup();
        showToast('Latest backup deleted.');
      } catch (e) {
        showToast(`Delete failed: ${formatError(e)}`, 'error');
      }
    });

  // Load backups initially
  window.listBackups().catch((e) => {
    showToast(`Load backups: ${formatError(e)}`, 'error');
  });

  // Handlers
  panel
    .querySelector('#rescue-restore-latest')
    .addEventListener('click', async () => {
      const id = document.getElementById('rescue-docid').value.trim();
      if (!id) return alert('Enter Document ID.');
      await window.restoreLatestById(id);
    });

  panel
    .querySelector('#rescue-merge-json')
    .addEventListener('click', async () => {
      const id = document.getElementById('rescue-docid').value.trim();
      if (!id) return alert('Enter Document ID.');
      const raw = document.getElementById('rescue-json').value.trim();
      if (!raw) return alert('Paste JSON snapshot to merge.');
      let json;
      try {
        json = JSON.parse(raw);
      } catch {
        return alert('Invalid JSON.');
      }
      await window.forceMergeJson(id, json);
      alert('Merged JSON into document (merge-safe).');
    });
}

// ===== Full backup/restore helpers =====
window.backupNow = async function () {
  if (!currentUser?.uid) {
    showToast('No user.', 'error');
    return;
  }
  const qAll = query(collection(db, 'users', currentUser.uid, 'ingredients'));
  const snap = await getDocs(qAll);
  const items = [];
  snap.forEach((d) => items.push({ id: d.id, data: d.data() }));

  const payload = { ts: Timestamp.now(), count: items.length, items };
  await addDoc(
    collection(db, 'users', currentUser.uid, 'ing_backups'),
    payload
  );
  showToast(`Backup saved (${items.length} items).`);
  await window.listBackups();
};

window.listBackups = async function () {
  if (!currentUser?.uid) return;
  const listEl = document.getElementById('rescue-backup-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="text-gray-500">Loading…</div>';

  const qB = query(
    collection(db, 'users', currentUser.uid, 'ing_backups'),
    orderBy('ts', 'desc')
  );
  const snap = await getDocs(qB);

  if (snap.empty) {
    listEl.innerHTML = '<div class="text-gray-500">No backups yet</div>';
    return;
  }

  const rows = [];
  snap.forEach((d) => {
    const b = d.data();
    const when = b.ts?.toDate ? b.ts.toDate().toLocaleString() : '';
    const id = d.id;
    rows.push(`
      <div class="border rounded p-2 flex items-center justify-between">
        <div>
          <div class="font-medium">${when}</div>
          <div class="text-gray-600">ID:${id} • ${
      b.count ?? (b.items?.length || 0)
    } items</div>
        </div>
        <div class="flex gap-1">
          <button class="bg-blue-600 text-white px-2 py-1 rounded" onclick="restoreBackupById('${id}')">Restore</button>
          <button class="bg-red-600 text-white px-2 py-1 rounded" onclick="deleteBackupById('${id}')">Delete</button>
        </div>
      </div>
    `);
  });
  listEl.innerHTML = rows.join('');
};

window.restoreBackupById = async function (backupId) {
  if (!currentUser?.uid) {
    showToast('No user.', 'error');
    return;
  }
  const bRef = doc(db, 'users', currentUser.uid, 'ing_backups', backupId);
  const bSnap = await getDoc(bRef);
  if (!bSnap.exists()) {
    showToast('Backup not found.', 'error');
    return;
  }
  const b = bSnap.data();
  const items = Array.isArray(b.items) ? b.items : [];

  // Replace current list with snapshot
  const qAll = query(collection(db, 'users', currentUser.uid, 'ingredients'));
  const snap = await getDocs(qAll);
  const currentIds = new Set();
  snap.forEach((d) => currentIds.add(d.id));

  for (const it of items) {
    const ref = doc(db, 'users', currentUser.uid, 'ingredients', it.id);
    await setDoc(ref, sanitizeSnapshot(it.data));
    currentIds.delete(it.id);
  }
  for (const id of currentIds) {
    await deleteDoc(doc(db, 'users', currentUser.uid, 'ingredients', id));
  }

  await saveHistory('RESTORE(FULL)', 'ALL', null, {
    backupId,
    count: items.length,
  });
  showToast(`Restored backup (${items.length} items).`);
};

window.deleteBackupById = async function (backupId) {
  if (!currentUser?.uid) {
    showToast('No user.', 'error');
    return;
  }
  await deleteDoc(doc(db, 'users', currentUser.uid, 'ing_backups', backupId));
  await window.listBackups();
  showToast('Backup deleted.');
};

window.restoreLatestBackup = async function () {
  if (!currentUser?.uid) {
    showToast('No user.', 'error');
    return;
  }
  const qB = query(
    collection(db, 'users', currentUser.uid, 'ing_backups'),
    orderBy('ts', 'desc')
  );
  const snap = await getDocs(qB);
  if (snap.empty) {
    showToast('No backups found.', 'error');
    return;
  }
  await window.restoreBackupById(snap.docs[0].id);
};

window.deleteLatestBackup = async function () {
  if (!currentUser?.uid) {
    showToast('No user.', 'error');
    return;
  }
  const qB = query(
    collection(db, 'users', currentUser.uid, 'ing_backups'),
    orderBy('ts', 'desc')
  );
  const snap = await getDocs(qB);
  if (snap.empty) {
    showToast('No backups to delete.', 'error');
    return;
  }
  await window.deleteBackupById(snap.docs[0].id);
};

// Latest snapshot restore using history (prefers afterData, falls back to beforeData)
window.restoreLatestById = async function (itemId) {
  try {
    if (!currentUser?.uid) return alert('No user.');
    const qHist = query(
      collection(db, 'users', currentUser.uid, 'ing_history'),
      orderBy('ts', 'desc')
    );
    const snap = await getDocs(qHist);

    for (const d of snap.docs) {
      const h = d.data();
      if (h.itemId === itemId) {
        const ref = doc(db, 'users', currentUser.uid, 'ingredients', itemId);
        const payload = h.afterData || h.beforeData;
        if (!payload) continue;
        await restoreDocMerge(ref, payload);
        await saveHistory(
          'RESTORE(LATEST)',
          itemId,
          null,
          sanitizeSnapshot(payload)
        );
        showUndoSnackbar(
          `Restored latest snapshot for: "${payload.name || itemId}"`
        );
        return;
      }
    }
    alert('No snapshot found in history for this ID.');
  } catch (e) {
    console.error('restoreLatestById failed:', e);
    alert('Restore failed. See console.');
  }
};

// Force merge an arbitrary JSON snapshot into a document
window.forceMergeJson = async function (itemId, json) {
  try {
    if (!currentUser?.uid) return alert('No user.');
    const ref = doc(db, 'users', currentUser.uid, 'ingredients', itemId);
    await restoreDocMerge(ref, json);
    await saveHistory('RESCUE(MERGE)', itemId, null, sanitizeSnapshot(json));
  } catch (e) {
    console.error('forceMergeJson failed:', e);
    alert('Force merge failed. See console.');
  }
};

/* ===============================
   추가/수정/삭제
   =============================== */
// “YYYY-MM-01” 버튼 → #expiry에 세팅
const setExpiryBtn = document.getElementById('set-expiry-btn');
if (setExpiryBtn) {
  setExpiryBtn.addEventListener('click', () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    document.getElementById('expiry').value = `${y}-${m}-01`;
  });
}

// 대량 등록 (기본 만료일: 올해-이번달-01)
document.getElementById('bulk-add-btn').addEventListener('click', async () => {
  const rawText = document.getElementById('bulk-input').value;
  if (!rawText.trim()) return alert('구매내역을 붙여넣으세요.');

  const lines = rawText.split('\n');
  const items = [];
  lines.forEach((line) => {
    const match = line.match(/^\[(.*?)\]\s*(.+?)(\s+\d|$)/);
    if (match) items.push(`${match[1]} ${match[2]}`.trim());
  });

  if (!items.length) return alert('상품명을 찾을 수 없습니다.');

  const d = new Date();
  const defaultISO = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    '0'
  )}-01`;

  try {
    for (const name of items) {
      await addDoc(collection(db, 'users', currentUser.uid, 'ingredients'), {
        name,
        qty: 1,
        expiry: Timestamp.fromDate(new Date(defaultISO)),
        storage: 'RF',
      });
    }
    alert(`${items.length}개의 상품이 등록되었습니다.`);
    document.getElementById('bulk-input').value = '';
  } catch (err) {
    console.error('❌ Bulk add error:', err);
    showToast(`Bulk add failed: ${formatError(err)}`, 'error');
  }
});

// 단건 추가
document.getElementById('add-btn').addEventListener('click', async () => {
  const name = document.getElementById('name').value.trim();
  const qty = parseInt(document.getElementById('qty').value);
  const expiry = document.getElementById('expiry').value;
  const storage = document.getElementById('storage').value;

  if (!name || !qty || !expiry || !storage)
    return alert('모든 칸을 채워주세요.');

  try {
    const docRef = await addDoc(
      collection(db, 'users', currentUser.uid, 'ingredients'),
      {
        name,
        qty,
        expiry: Timestamp.fromDate(new Date(expiry)),
        storage,
      }
    );
    await saveHistory('ADD', docRef.id, null, {
      name,
      qty,
      expiry: Timestamp.fromDate(new Date(expiry)),
      storage,
    });
  } catch (err) {
    console.error('❌ Add ingredient error:', err);
    showToast(`Add failed: ${formatError(err)}`, 'error');
  }

  document.getElementById('name').value = '';
  document.getElementById('qty').value = '';
  document.getElementById('expiry').value = '';
});

// 저장 방식 변경
window.changeStorage = async (id, newStorage) => {
  try {
    const ref = doc(db, 'users', currentUser.uid, 'ingredients', id);
    const before = (await getDoc(ref)).data();
    await updateDoc(ref, { storage: newStorage });
    await saveHistory('EDIT', id, before, { ...before, storage: newStorage });
  } catch (err) {
    console.error('❌ 저장 방식 변경 오류:', err);
    showToast(`Storage change failed: ${formatError(err)}`, 'error');
  }
};

// 유통기한 수정
window.editExpiry = async (id, currentDate) => {
  const newDate = prompt('New Exp (YYYY-MM-DD)', currentDate);
  if (!newDate) return;
  if (isNaN(new Date(newDate))) return alert('Invalid date.');

  try {
    const ref = doc(db, 'users', currentUser.uid, 'ingredients', id);
    const before = (await getDoc(ref)).data();
    await updateDoc(ref, { expiry: Timestamp.fromDate(new Date(newDate)) });
    await saveHistory('EDIT', id, before, {
      ...before,
      expiry: Timestamp.fromDate(new Date(newDate)),
    });
    alert('Exp updated.');
  } catch (err) {
    console.error('❌ Exp edit err:', err);
    showToast(`Expiry edit failed: ${formatError(err)}`, 'error');
  }
};

// 일부/전량 삭제 (UNDO 지원)
window.deleteIngredient = async (id) => {
  try {
    const ref = doc(db, 'users', currentUser.uid, 'ingredients', id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return alert('Item not found.');
    const data = snap.data();

    if (data.qty > 1) {
      let toDelete = prompt(
        `QTY: ${data.qty}\nDEL QTY (1 ~ ${data.qty}):`,
        '1'
      );
      if (toDelete === null) return;
      toDelete = parseInt(toDelete, 10);
      if (isNaN(toDelete) || toDelete < 1 || toDelete > data.qty) {
        return alert('Invalid qty.');
      }

      if (toDelete < data.qty) {
        const before = { ...data };
        const after = { ...data, qty: data.qty - toDelete };
        await updateDoc(ref, { qty: after.qty });
        await saveHistory('DEL', id, before, after);

        // UNDO: 수량 복원
        showUndoSnackbar(
          `Deleted ${toDelete} of "${data.name}" (now ${after.qty})`,
          async () => {
            await updateDoc(ref, { qty: before.qty });
            await saveHistory('UNDO', id, after, before);
          }
        );
      } else {
        // 전량 삭제
        const before = { ...data };
        await deleteDoc(ref);
        await saveHistory('DEL', id, before, null);

        // UNDO: 문서 복원
        showUndoSnackbar(`Deleted "${data.name}" (all)`, async () => {
          await restoreDocMerge(ref, before);
          await saveHistory('UNDO', id, null, before);
        });
      }
    } else {
      // qty === 1 → 전량 삭제
      const before = { ...data };
      await deleteDoc(ref);
      await saveHistory('DEL', id, before, null);

      showUndoSnackbar(`Deleted "${data.name}"`, async () => {
        await restoreDocMerge(ref, before);
        await saveHistory('UNDO', id, null, before);
      });
    }
  } catch (err) {
    console.error('❌ DEL error:', err);
    showToast(`Delete failed: ${formatError(err)}`, 'error');
  }
};

window.deleteIngredientAll = async (id) => {
  if (!confirm('정말 이 항목을 전부 삭제하시겠습니까?')) return;
  try {
    const ref = doc(db, 'users', currentUser.uid, 'ingredients', id);
    const beforeSnap = await getDoc(ref);
    if (!beforeSnap.exists()) return;
    const before = beforeSnap.data();

    await deleteDoc(ref);
    await saveHistory('DEL', id, before, null);

    showUndoSnackbar(`Deleted "${before.name}" (all)`, async () => {
      await restoreDocMerge(ref, before);
      await saveHistory('UNDO', id, null, before);
    });
  } catch (err) {
    console.error('❌ 전체 삭제 error:', err);
    showToast(`Delete-all failed: ${formatError(err)}`, 'error');
  }
};

// 선택 삭제
document
  .getElementById('delete-selected-btn')
  .addEventListener('click', async () => {
    try {
      const checked = document.querySelectorAll('.select-item:checked');
      if (!checked.length) return alert('선택된 항목이 없습니다.');
      if (!confirm('선택한 항목을 삭제하시겠습니까?')) return;

      const victims = [];
      for (const cb of checked) {
        const id = cb.dataset.id;
        const ref = doc(db, 'users', currentUser.uid, 'ingredients', id);
        const s = await getDoc(ref);
        if (s.exists()) victims.push({ id, ref, before: s.data() });
      }

      for (const v of victims) {
        await deleteDoc(v.ref);
        await saveHistory('DEL', v.id, v.before, null);
      }

      showUndoSnackbar(`Deleted ${victims.length} item(s)`, async () => {
        for (const v of victims) {
          await restoreDocMerge(v.ref, v.before);
          await saveHistory('UNDO', v.id, null, v.before);
        }
      });
    } catch (err) {
      console.error('❌ Delete-selected error:', err);
      showToast(`Delete-selected failed: ${formatError(err)}`, 'error');
    }
  });

// 전체 삭제
document
  .getElementById('delete-all-btn')
  .addEventListener('click', async () => {
    if (!confirm('목록 전체를 삭제하시겠습니까?')) return;

    const qAll = query(collection(db, 'users', currentUser.uid, 'ingredients'));
    const snap = await getDocs(qAll);

    const victims = [];
    snap.forEach((d) => {
      const ref = doc(db, 'users', currentUser.uid, 'ingredients', d.id);
      victims.push({ id: d.id, ref, before: d.data() });
    });

    for (const v of victims) {
      await deleteDoc(v.ref);
      await saveHistory('DEL', v.id, v.before, null);
    }

    showUndoSnackbar(`Deleted ALL (${victims.length})`, async () => {
      for (const v of victims) {
        await restoreDocMerge(v.ref, v.before);
        await saveHistory('UNDO', v.id, null, v.before);
      }
    });
  });

/* ===============================
   필터 버튼
   =============================== */
document.getElementById('filter-all').addEventListener('click', () => {
  storageFilter = null;
  loadIngredients();
});
document.getElementById('filter-cold').addEventListener('click', () => {
  storageFilter = 'RF';
  loadIngredients();
});
document.getElementById('filter-freeze').addEventListener('click', () => {
  storageFilter = 'FR';
  loadIngredients();
});
document.getElementById('filter-cc').addEventListener('click', () => {
  storageFilter = 'CC';
  loadIngredients();
});

/* ===============================
   레시피 (로컬 & AI)
   =============================== */
const recipeDB = [
  { name: '된장찌개', ingredients: ['두부', '감자', '양파'] },
  { name: '계란말이', ingredients: ['계란', '소금', '대파'] },
  { name: '김치볶음밥', ingredients: ['김치', '밥', '계란'] },
  { name: '감자조림', ingredients: ['감자', '간장', '설탕'] },
];

function renderRecipes(myIngredients) {
  const recArea = document.getElementById('recipes');
  recArea.innerHTML = '';
  recipeDB.forEach((r) => {
    const matchCount = r.ingredients.filter((ing) =>
      myIngredients.includes(ing)
    ).length;
    if (matchCount / r.ingredients.length >= 0.7) {
      recArea.innerHTML += `<div>🍽 ${r.name} <small>(필요: ${r.ingredients.join(
        ', '
      )})</small></div>`;
    }
  });
}

async function getAiRecipeSuggestion(ingredients) {
  if (!ingredients.length) return;
  try {
    const response = await fetch(`${import.meta.env.VITE_API_URL}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ingredients }),
    });

    const text = await response.text();
    if (!text) throw new Error('서버에서 빈 응답을 받았습니다.');

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('AI 서버 응답 형식이 잘못되었습니다.');
    }

    if (data.error) throw new Error(`추천 불가 (사유: ${data.error})`);

    let suggestions = [];
    if (Array.isArray(data.recipe)) suggestions = data.recipe;
    else if (typeof data.recipe === 'string') {
      suggestions = data.recipe
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    suggestions = suggestions.slice(0, 5);

    let infoLine = '';
    if (data.tokens !== undefined && data.remainingFree !== undefined) {
      infoLine = `<div class="text-xs text-gray-500">📊 이번 요청 토큰: ${data.tokens}개 · 남은 무료 요청: ${data.remainingFree}회</div>`;
    }

    const html = suggestions
      .map(
        (s) =>
          `<div class="mt-2 text-green-700 font-semibold">🤖 AI 추천 요리: ${s}</div>`
      )
      .join('');
    document.getElementById('recipes').innerHTML =
      html + infoLine + document.getElementById('recipes').innerHTML;
  } catch (err) {
    console.error('❌ AI 추천 오류:', err);
    showToast(`AI fail: ${formatError(err)}`, 'error');
    document.getElementById(
      'recipes'
    ).innerHTML += `<div class="text-red-500">AI 추천 실패: ${err.message}</div>`;
  }
}

/* ===============================
   히스토리 토글/로드
   =============================== */
document
  .getElementById('show-history-btn')
  .addEventListener('click', async () => {
    const historyDiv = document.getElementById('history');
    const isHidden =
      historyDiv.style.display === 'none' || historyDiv.style.display === '';
    historyDiv.style.display = isHidden ? 'block' : 'none';
    if (!isHidden) return;

    historyDiv.innerHTML = '';
    const q = query(
      collection(db, 'users', currentUser.uid, 'ing_history'),
      orderBy('ts', 'desc')
    );
    const snap = await getDocs(q);

    // reset cache
    window._histCache = [];

    if (snap.empty) {
      historyDiv.innerHTML =
        '<div class="text-gray-500 py-2">No history available</div>';
      return;
    }

    let idx = 0;
    snap.forEach((d) => {
      const h = d.data();
      // push to cache for later UNDO
      window._histCache.push({
        act: h.act,
        itemId: h.itemId,
        beforeData: h.beforeData || null,
        afterData: h.afterData || null,
      });

      let nameLine = `${h.beforeData?.name || h.afterData?.name || ''}`;
      if (h.qtyChange)
        nameLine += ` <span class="text-blue-600">${h.qtyChange}</span>`;

      historyDiv.innerHTML += `
      <div class="border-b py-2 text-sm flex items-start justify-between gap-2">
        <div>
          <b>[${h.act}]</b> ${nameLine} (${h.user})<br>
          <small>${h.ts?.toDate ? h.ts.toDate().toLocaleString() : ''}</small>
        </div>
        <button class="shrink-0 bg-gray-800 text-white px-2 py-1 rounded text-xs hover:bg-black"
                onclick="undoHistory(${idx})">UNDO</button>
      </div>
    `;
      idx++;
    });
  });

// Inverse operation for a single history record
window.undoHistory = async function (i) {
  try {
    const h = window._histCache[i];
    if (!h) return alert('History entry not found.');
    if (!currentUser?.uid) return alert('No user.');

    const ref = doc(db, 'users', currentUser.uid, 'ingredients', h.itemId);

    if (h.act === 'ADD') {
      // Original was create -> undo by delete
      await deleteDoc(ref);
      await saveHistory('UNDO(HIS)', h.itemId, h.afterData || null, null);
      showUndoSnackbar(`Reverted ADD: "${h.afterData?.name || ''}"`);
      return;
    }

    if (h.act === 'DEL') {
      // Original was delete -> undo by restoring beforeData
      if (!h.beforeData) return alert('No snapshot to restore.');
      await restoreDocMerge(ref, h.beforeData);
      await saveHistory('UNDO(HIS)', h.itemId, null, h.beforeData);
      showUndoSnackbar(`Restored: "${h.beforeData?.name || ''}"`);
      return;
    }

    if (h.act === 'EDIT') {
      // Original was edit -> undo by restoring previous fields
      if (!h.beforeData) return alert('No previous data to restore.');
      await restoreDocMerge(ref, h.beforeData);
      await saveHistory(
        'UNDO(HIS)',
        h.itemId,
        h.afterData || null,
        h.beforeData
      );
      showUndoSnackbar(`Reverted EDIT: "${h.beforeData?.name || ''}"`);
      return;
    }

    alert('This history type cannot be undone.');
  } catch (e) {
    console.error('undoHistory failed:', e);
    alert('Failed to undo this history entry.');
  }
};

// 🆘 Emergency: restore the latest "afterData" for a given item from history
// Usage in DevTools: restoreFromHistory('<documentId>');
window.restoreFromHistory = async function (itemId) {
  try {
    if (!currentUser?.uid) return alert('No user.');
    const q = query(
      collection(db, 'users', currentUser.uid, 'ing_history'),
      orderBy('ts', 'desc')
    );
    const snap = await getDocs(q);

    for (const d of snap.docs) {
      const h = d.data();
      if (h.itemId === itemId && h.afterData) {
        const ref = doc(db, 'users', currentUser.uid, 'ingredients', itemId);
        await restoreDocMerge(ref, h.afterData);
        await saveHistory('RESTORE(LATEST)', itemId, null, h.afterData);
        alert(`Restored latest snapshot for: ${h.afterData.name || itemId}`);
        return;
      }
    }
    alert('No afterData snapshot found for this item.');
  } catch (e) {
    console.error('restoreFromHistory failed:', e);
    alert('Restore failed. See console.');
  }
};
