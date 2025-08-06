// 🔹 Soon Expiring 표시 함수
function showSoonExpiring() {
  const soonDivId = 'soon-expiring';
  let soonDiv = document.getElementById(soonDivId);
  if (!soonDiv) {
    // 섹션이 없으면 inventory 위에 생성
    soonDiv = document.createElement('div');
    soonDiv.id = soonDivId;
    soonDiv.className =
      'bg-yellow-100 border border-yellow-300 rounded-md p-2 text-xs text-yellow-800 mb-2';
    const inv = document.getElementById('inventory');
    inv.parentNode.insertBefore(soonDiv, inv);
  }
  soonDiv.innerHTML = '<b>⚠ Soon Expiring</b><br>';

  const today = new Date();
  const q = query(
    collection(db, 'users', currentUser.uid, 'ingredients'),
    orderBy('expiry')
  );
  getDocs(q).then((snap) => {
    let found = false;
    snap.forEach((docSnap) => {
      const item = docSnap.data();
      let expiryDate;
      if (item.expiry?.toDate) {
        expiryDate = item.expiry.toDate();
      } else {
        expiryDate = new Date(item.expiry);
      }
      const daysLeft = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
      if (daysLeft <= 3 && daysLeft >= -3) {
        soonDiv.innerHTML += `- ${item.name} (${item.qty}) D${
          daysLeft >= 0 ? '-' + daysLeft : '+' + Math.abs(daysLeft)
        }<br>`;
        found = true;
      }
    });
    if (!found) {
      soonDiv.innerHTML += '<i>None</i>';
    }
  });
}
/**
 * 🔹 로그인/로그아웃 UI 업데이트 함수
 */
function updateAuthUI(user) {
  const loginSection = document.getElementById('login-section');
  if (user) {
    // 로그인 상태
    loginSection.innerHTML = `
      <div class="flex items-center gap-4">
        <span class="text-gray-700 text-sm"> Logged in as ${
          user.displayName || '사용자'
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
    // 로그아웃 상태
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
// 🔹 대량 등록
document.getElementById('bulk-add-btn').addEventListener('click', async () => {
  const rawText = document.getElementById('bulk-input').value;
  if (!rawText.trim()) return alert('구매내역을 붙여넣으세요.');

  const lines = rawText.split('\n');
  const items = [];

  // [브랜드] 상품명 형태에서 이름 추출
  lines.forEach((line) => {
    const match = line.match(/^\[(.*?)\]\s*(.+?)(\s+\d|$)/);
    if (match) {
      const name = `${match[1]} ${match[2]}`.trim();
      items.push(name);
    }
  });

  if (items.length === 0) {
    alert('상품명을 찾을 수 없습니다.');
    return;
  }

  for (let name of items) {
    await addDoc(collection(db, 'users', currentUser.uid, 'ingredients'), {
      name,
      qty: 1,
      expiry: Timestamp.fromDate(new Date('2000-01-01')), // 기본값
      storage: 'RF', // 기본 저장 방식
    });
  }

  alert(`${items.length}개의 상품이 등록되었습니다.`);
  document.getElementById('bulk-input').value = '';
});
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
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

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
let storageFilter = null;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  functions = getFunctions(app);
} catch (error) {
  console.error('❌ Firebase initialization error:', error);
}

let aiSuggestedOnce = false; // ✅ AI 추천 중복 방지 플래그

// 🔹 Save action history
async function saveHistory(act, itemId, beforeData, afterData) {
  if (!currentUser || !currentUser.uid) {
    console.warn('⚠ No currentUser, history not saved.');
    return;
  }

  try {
    // Firestore는 Timestamp, 함수 등을 직렬화 못 하므로 JSON 변환 처리
    const cleanBefore = beforeData
      ? JSON.parse(JSON.stringify(beforeData))
      : null;
    const cleanAfter = afterData ? JSON.parse(JSON.stringify(afterData)) : null;

    // qty 변동 정보 생성
    let qtyChange = undefined;
    if (
      cleanBefore &&
      cleanAfter &&
      typeof cleanBefore.qty === 'number' &&
      typeof cleanAfter.qty === 'number' &&
      cleanBefore.qty !== cleanAfter.qty
    ) {
      qtyChange = `(QTY: ${cleanBefore.qty} → ${cleanAfter.qty})`;
    }

    // Build data object for Firestore
    const data = {
      act, // ADD, DEL, EDIT
      itemId,
      beforeData: cleanBefore,
      afterData: cleanAfter,
      ts: Timestamp.now(),
      user: currentUser.displayName || currentUser.email || 'ANON',
    };
    if (qtyChange !== undefined && qtyChange !== '') {
      data.qtyChange = qtyChange;
    }

    const docRef = await addDoc(
      collection(db, 'users', currentUser.uid, 'ing_history'),
      data
    );

    console.log(
      `✅ History saved to /users/${currentUser.uid}/ing_history/${docRef.id}`,
      { act, beforeData: cleanBefore, afterData: cleanAfter, qtyChange }
    );

    // 저장 직후 UI에 반영되도록 호출
    appendHistoryToUI({
      ...data,
      ts: Timestamp.now(), // ensure fresh timestamp
    });
  } catch (err) {
    console.error('❌ History save err:', err);
  }
}

// 히스토리 항목을 UI에 즉시 추가하는 함수
function appendHistoryToUI(h) {
  const historyDiv = document.getElementById('history');
  if (!historyDiv) return;

  // 히스토리가 숨겨져 있어도 데이터만 미리 추가
  const entry = document.createElement('div');
  entry.className = 'border-b py-2 text-sm';
  let nameLine = `${h.beforeData?.name || h.afterData?.name || ''}`;
  if (h.qtyChange) {
    nameLine += ` <span class="text-blue-600">${h.qtyChange}</span>`;
  }
  entry.innerHTML = `
    <b>[${h.act}]</b> ${nameLine} 
    (${h.user})<br>
    <small>${
      h.ts.toDate
        ? h.ts.toDate().toLocaleString()
        : new Date(h.ts.seconds * 1000).toLocaleString()
    }</small>
  `;

  // 맨 위에 추가
  historyDiv.insertBefore(entry, historyDiv.firstChild);
}

// 🔹 로그인 버튼
const loginBtn = document.getElementById('login-btn');
if (loginBtn) {
  loginBtn.addEventListener('click', async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error('❌ Login error:', err);
    }
  });
}

// 🔹 로그인 상태 감지 (UI 업데이트 통합)
onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (user) {
    document.getElementById('app').style.display = 'block';
  } else {
    document.getElementById('app').style.display = 'none';
  }
  updateAuthUI(user);
  if (user) loadIngredients();
});

// 🔹 재료 불러오기
// ⚠ Soon Expiring 실시간 업데이트 반영을 위해 loadIngredients 안에서 onSnapshot 사용 시
// 기존 soon-expiring 섹션을 항상 초기화하도록 개선
function loadIngredients() {
  const q = query(
    collection(db, 'users', currentUser.uid, 'ingredients'),
    orderBy('expiry')
  );
  onSnapshot(q, (snapshot) => {
    const list = document.getElementById('inventory');
    list.innerHTML = '';

    const today = new Date();
    let myIngredients = [];

    // ⚠ Soon Expiring 섹션 초기화 (매 스냅샷 시마다 새로 생성/갱신)
    let soonExpDiv = document.getElementById('soon-expiring');
    if (!soonExpDiv) {
      soonExpDiv = document.createElement('div');
      soonExpDiv.id = 'soon-expiring';
      soonExpDiv.className =
        'bg-yellow-100 border border-yellow-300 rounded-md p-2 text-xs text-yellow-800 mb-2';
      list.parentNode.insertBefore(soonExpDiv, list);
    }
    let soonExpiringItems = [];
    soonExpDiv.innerHTML = '<b>⚠ Soon Expiring</b><br>'; // 매번 초기화

    // ✅ RF/FR/CC 구분용 배열
    let coldItems = [];
    let freezeItems = [];
    let ccItems = [];

    snapshot.forEach((docSnap) => {
      const item = docSnap.data();

      // 🛠 이미 삭제된 아이템은 건너뛰기 (데이터가 없거나 이름이 없는 경우)
      if (!item || !item.name) return;

      myIngredients.push(item.name);

      // ✅ Timestamp 또는 string 모두 처리
      let expiryDate;
      if (item.expiry?.toDate) {
        expiryDate = item.expiry.toDate();
      } else {
        expiryDate = new Date(item.expiry);
      }
      const daysLeft = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));

      // ⚠ 3일 이하 남은 경우 soonExpiringItems에 추가
      if (daysLeft <= 3) {
        soonExpiringItems.push(
          `- ${item.name} (${item.qty}) D${
            daysLeft >= 0 ? '-' + daysLeft : '+' + Math.abs(daysLeft)
          }`
        );
      }

      const itemHTML = `
        <div class="flex items-center justify-between bg-white border p-2 rounded mb-1">
          <div class="flex items-center gap-2">
            <input type="checkbox" class="select-item" data-id="${docSnap.id}">
            <select onchange="changeStorage('${
              docSnap.id
            }', this.value)" class="border rounded px-1 py-0.5 text-xs">
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
            <span>${item.name} (${item.qty}) -
              <span class="${daysLeft <= 3 ? 'text-red-500 font-bold' : ''}">
                D${daysLeft >= 0 ? '-' + daysLeft : '+' + Math.abs(daysLeft)}
              </span>
            </span>
          </div>
          <div class="flex flex-wrap gap-2 justify-end items-center">
            <button class="bg-blue-500 text-white px-2 py-1 rounded text-xs whitespace-nowrap" onclick="editExpiry('${
              docSnap.id
            }', '${expiryDate.toISOString().split('T')[0]}')">EDIT-EXP</button>
            <button class="bg-yellow-500 text-white px-2 py-1 rounded text-xs whitespace-nowrap" onclick="deleteIngredient('${
              docSnap.id
            }')">DEL</button>
            <button class="bg-red-600 text-white px-2 py-1 rounded text-xs whitespace-nowrap" onclick="deleteIngredientAll('${
              docSnap.id
            }')">DEL-ALL</button>
          </div>
        </div>`;

      if (item.storage === 'RF') {
        coldItems.push(itemHTML);
      } else if (item.storage === 'FR') {
        freezeItems.push(itemHTML);
      } else if (item.storage === 'CC') {
        ccItems.push(itemHTML);
      }
    });

    // ⚠ Soon Expiring 표시 (실시간 반영)
    if (soonExpiringItems.length > 0) {
      soonExpDiv.innerHTML =
        '<b>⚠ Soon Expiring</b><br>' + soonExpiringItems.join('<br>');
    } else {
      soonExpDiv.innerHTML = '<b>⚠ Soon Expiring</b><br><i>None</i>';
    }

    // ✅ RF/FR/CC 구분 출력
    if (coldItems.length > 0) {
      list.innerHTML +=
        `<h3 class="text-lg font-semibold text-blue-600 mt-4 mb-2">❄ RF</h3>` +
        coldItems.join('');
    }
    if (freezeItems.length > 0) {
      list.innerHTML +=
        `<h3 class="text-lg font-semibold text-indigo-600 mt-4 mb-2">🧊 FR</h3>` +
        freezeItems.join('');
    }
    if (ccItems.length > 0) {
      list.innerHTML +=
        `<h3 class="text-lg font-semibold text-orange-600 mt-4 mb-2">🥶 CC</h3>` +
        ccItems.join('');
    }

    renderRecipes(myIngredients);

    if (!aiSuggestedOnce && myIngredients.length > 0) {
      aiSuggestedOnce = true;
      getAiRecipeSuggestion(myIngredients);
    }
  });
}

// 🔹 storage 변경 처리 함수
window.changeStorage = async (id, newStorage) => {
  try {
    const ingredientRef = doc(db, 'users', currentUser.uid, 'ingredients', id);
    const beforeSnap = await getDoc(ingredientRef);
    const beforeData = beforeSnap.data();
    await updateDoc(ingredientRef, {
      storage: newStorage,
    });
    await saveHistory('EDIT', id, beforeData, {
      ...beforeData,
      storage: newStorage,
    });
  } catch (err) {
    console.error('❌ 저장 방식 변경 오류:', err);
  }
};

// 🔹 유통기한 수정
window.editExpiry = async (id, currentDate) => {
  const newDate = prompt('New Exp (YYYY-MM-DD)', currentDate);
  if (!newDate) return;
  if (isNaN(new Date(newDate))) {
    alert('Invalid date.');
    return;
  }
  try {
    const ingredientRef = doc(db, 'users', currentUser.uid, 'ingredients', id);
    const beforeSnap = await getDoc(ingredientRef);
    const beforeData = beforeSnap.data();

    await updateDoc(ingredientRef, {
      expiry: Timestamp.fromDate(new Date(newDate)),
    });

    await saveHistory('EDIT', id, beforeData, {
      ...beforeData,
      expiry: Timestamp.fromDate(new Date(newDate)),
    });

    alert('Exp updated.');
  } catch (err) {
    console.error('❌ Exp edit err:', err);
  }
};

// 🔹 재료 추가
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
    // Save to history (ADD)
    await saveHistory('ADD', docRef.id, null, {
      name,
      qty,
      expiry: Timestamp.fromDate(new Date(expiry)),
      storage,
    });
  } catch (err) {
    console.error('❌ Add ingredient error:', err);
  }

  document.getElementById('name').value = '';
  document.getElementById('qty').value = '';
  document.getElementById('expiry').value = '';
});

// 🔹 재료 삭제 (수량 일부)
window.deleteIngredient = async (id) => {
  try {
    const ingredientRef = doc(db, 'users', currentUser.uid, 'ingredients', id);
    const ingredientSnap = await getDoc(ingredientRef);
    if (!ingredientSnap.exists()) {
      alert('Item not found.');
      return;
    }
    const data = ingredientSnap.data();
    if (data.qty > 1) {
      let toDelete = prompt(
        `QTY: ${data.qty}\nDEL QTY (1 ~ ${data.qty}):`,
        '1'
      );
      if (toDelete === null) return;
      toDelete = parseInt(toDelete, 10);
      if (isNaN(toDelete) || toDelete < 1) return alert('Invalid qty.');
      if (toDelete < data.qty) {
        await updateDoc(ingredientRef, { qty: data.qty - toDelete });
        await saveHistory('DEL', id, data, {
          ...data,
          qty: data.qty - toDelete,
        });
      } else {
        // Save history BEFORE deletion
        await saveHistory('DEL', id, data, null);
        await deleteDoc(ingredientRef);
      }
    } else {
      // Save history BEFORE deletion
      await saveHistory('DEL', id, data, null);
      await deleteDoc(ingredientRef);
    }
  } catch (err) {
    console.error('❌ DEL error:', err);
  }
};

// 🔹 재료 전체 삭제 (단일)
window.deleteIngredientAll = async (id) => {
  if (!confirm('정말 이 항목을 전부 삭제하시겠습니까?')) return;
  try {
    const ingredientRef = doc(db, 'users', currentUser.uid, 'ingredients', id);
    const beforeSnap = await getDoc(ingredientRef);
    const beforeData = beforeSnap.data();
    // Save history BEFORE deletion
    await saveHistory('DEL', id, beforeData, null);
    await deleteDoc(ingredientRef);
  } catch (err) {
    console.error('❌ 전체 삭제 error:', err);
  }
};

// 🔹 선택 삭제
document
  .getElementById('delete-selected-btn')
  .addEventListener('click', async () => {
    const checkedBoxes = document.querySelectorAll('.select-item:checked');
    if (checkedBoxes.length === 0) return alert('선택된 항목이 없습니다.');
    if (!confirm('선택한 항목을 삭제하시겠습니까?')) return;

    for (const checkbox of checkedBoxes) {
      const id = checkbox.dataset.id;
      const ingredientRef = doc(
        db,
        'users',
        currentUser.uid,
        'ingredients',
        id
      );
      const beforeSnap = await getDoc(ingredientRef);
      const beforeData = beforeSnap.data();
      // Save history BEFORE deletion
      await saveHistory('DEL', id, beforeData, null);
      await deleteDoc(ingredientRef);
    }
  });

// 🔹 전체 삭제 (목록)
document
  .getElementById('delete-all-btn')
  .addEventListener('click', async () => {
    if (!confirm('목록 전체를 삭제하시겠습니까?')) return;
    const q = query(collection(db, 'users', currentUser.uid, 'ingredients'));
    const snap = await getDocs(q);
    for (const docSnap of snap.docs) {
      const beforeData = docSnap.data();
      // Save history BEFORE deletion
      await saveHistory('DEL', docSnap.id, beforeData, null);
      await deleteDoc(
        doc(db, 'users', currentUser.uid, 'ingredients', docSnap.id)
      );
    }
  });

// 🔹 필터 버튼
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

// 🔹 레시피 추천 (기존 하드코딩)
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

// 🔹 AI 요리 추천 (Vercel Serverless API 호출)
async function getAiRecipeSuggestion(ingredients) {
  if (ingredients.length === 0) return;

  try {
    const response = await fetch(`${import.meta.env.VITE_API_URL}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ingredients }),
    });

    const text = await response.text();
    if (!text) {
      throw new Error('서버에서 빈 응답을 받았습니다.');
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      console.error('❌ JSON 파싱 오류. 응답 내용:', text);
      throw new Error('AI 서버 응답 형식이 잘못되었습니다.');
    }

    // API가 에러 메시지를 반환한 경우
    if (data.error) {
      throw new Error(`추천 불가 (사유: ${data.error})`);
    }

    let suggestions = [];

    if (Array.isArray(data.recipe)) {
      suggestions = data.recipe;
    } else if (typeof data.recipe === 'string') {
      // 쉼표 또는 줄바꿈 기준으로 분리
      suggestions = data.recipe
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
    }

    // 최대 5개까지만 표시
    suggestions = suggestions.slice(0, 5);

    let infoLine = '';
    if (data.tokens !== undefined && data.remainingFree !== undefined) {
      infoLine = `<div class="text-xs text-gray-500">📊 이번 요청 토큰: ${data.tokens}개 · 남은 무료 요청: ${data.remainingFree}회</div>`;
    }

    const suggestionHTML = suggestions
      .map(
        (s) =>
          `<div class="mt-2 text-green-700 font-semibold">🤖 AI 추천 요리: ${s}</div>`
      )
      .join('');

    document.getElementById('recipes').innerHTML =
      suggestionHTML + infoLine + document.getElementById('recipes').innerHTML;
  } catch (err) {
    console.error('❌ AI 추천 오류:', err);
    document.getElementById(
      'recipes'
    ).innerHTML += `<div class="text-red-500">AI 추천 실패: ${err.message}</div>`;
  }
}

// 🔹 Show history
document
  .getElementById('show-history-btn')
  .addEventListener('click', async () => {
    const historyDiv = document.getElementById('history');
    historyDiv.innerHTML = '';

    // ✅ display 방식으로 토글
    if (
      historyDiv.style.display === 'none' ||
      historyDiv.style.display === ''
    ) {
      historyDiv.style.display = 'block';
    } else {
      historyDiv.style.display = 'none';
      return; // 닫을 때는 데이터 로드 안 함
    }

    const q = query(
      collection(db, 'users', currentUser.uid, 'ing_history'),
      orderBy('ts', 'desc')
    );

    const snap = await getDocs(q);
    console.log('📜 History snapshot size:', snap.size);

    if (snap.empty) {
      historyDiv.innerHTML =
        '<div class="text-gray-500 py-2">No history available</div>';
      return;
    }

    snap.forEach((docSnap) => {
      const h = docSnap.data();
      console.log('📜 History doc:', h);
      let nameLine = `${h.beforeData?.name || h.afterData?.name || ''}`;
      if (h.qtyChange) {
        nameLine += ` <span class="text-blue-600">${h.qtyChange}</span>`;
      }
      historyDiv.innerHTML += `
        <div class="border-b py-2 text-sm">
          <b>[${h.act}]</b> ${nameLine} 
          (${h.user})<br>
          <small>${h.ts.toDate().toLocaleString()}</small>
        </div>
      `;
    });
  });
