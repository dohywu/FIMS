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

// 🔹 로그인 상태 감지
onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    document.getElementById('app').style.display = 'block';
    document.getElementById('login-section').style.display = 'none';
    loadIngredients();
  } else {
    currentUser = null;
    document.getElementById('app').style.display = 'none';
    document.getElementById('login-section').style.display = 'flex';
  }
});

// 🔹 재료 불러오기
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

    snapshot.forEach((docSnap) => {
      const item = docSnap.data();

      if (storageFilter && item.storage !== storageFilter) return;

      myIngredients.push(item.name);

      // ✅ Timestamp 또는 string 모두 처리
      let expiryDate;
      if (item.expiry?.toDate) {
        expiryDate = item.expiry.toDate();
      } else {
        expiryDate = new Date(item.expiry);
      }

      const daysLeft = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));

      list.innerHTML += `
        <div class="flex items-center justify-between bg-white border p-2 rounded mb-1">
          <div class="flex items-center gap-2">
            <input type="checkbox" class="select-item" data-id="${docSnap.id}">
            <span>[${item.storage}] ${item.name} (${item.qty}) -
              <span class="${daysLeft <= 3 ? 'text-red-500 font-bold' : ''}">
                D${daysLeft >= 0 ? '-' + daysLeft : '+' + Math.abs(daysLeft)}
              </span>
            </span>
          </div>
          <div class="flex gap-2">
            <button class="bg-yellow-500 text-white px-2 py-1 rounded text-xs" onclick="deleteIngredient('${
              docSnap.id
            }')">삭제</button>
            <button class="bg-red-600 text-white px-2 py-1 rounded text-xs" onclick="deleteIngredientAll('${
              docSnap.id
            }')">전체삭제</button>
          </div>
        </div>`;
    });

    renderRecipes(myIngredients);
    getAiRecipeSuggestion(myIngredients); // AI 추천 호출
  });
}

// 🔹 재료 추가
document.getElementById('add-btn').addEventListener('click', async () => {
  const name = document.getElementById('name').value.trim();
  const qty = parseInt(document.getElementById('qty').value);
  const expiry = document.getElementById('expiry').value;
  const storage = document.getElementById('storage').value;
  if (!name || !qty || !expiry || !storage)
    return alert('모든 칸을 채워주세요.');

  try {
    await addDoc(collection(db, 'users', currentUser.uid, 'ingredients'), {
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
      alert('재료를 찾을 수 없습니다.');
      return;
    }
    const data = ingredientSnap.data();
    if (data.qty > 1) {
      let toDelete = prompt(
        `현재 수량: ${data.qty}\n삭제할 수량 입력 (1 ~ ${data.qty}):`,
        '1'
      );
      if (toDelete === null) return;
      toDelete = parseInt(toDelete, 10);
      if (isNaN(toDelete) || toDelete < 1)
        return alert('올바른 수량을 입력하세요.');
      if (toDelete < data.qty) {
        await updateDoc(ingredientRef, { qty: data.qty - toDelete });
      } else {
        await deleteDoc(ingredientRef);
      }
    } else {
      await deleteDoc(ingredientRef);
    }
  } catch (err) {
    console.error('❌ Delete ingredient error:', err);
  }
};

// 🔹 재료 전체 삭제 (단일)
window.deleteIngredientAll = async (id) => {
  if (!confirm('정말 이 항목을 전부 삭제하시겠습니까?')) return;
  try {
    await deleteDoc(doc(db, 'users', currentUser.uid, 'ingredients', id));
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
      await deleteDoc(doc(db, 'users', currentUser.uid, 'ingredients', id));
    }
  });

// 🔹 전체 삭제 (목록)
document
  .getElementById('delete-all-btn')
  .addEventListener('click', async () => {
    if (!confirm('목록 전체를 삭제하시겠습니까?')) return;
    const q = query(collection(db, 'users', currentUser.uid, 'ingredients'));
    const snap = await getDocs(q);
    snap.forEach(async (docSnap) => {
      await deleteDoc(
        doc(db, 'users', currentUser.uid, 'ingredients', docSnap.id)
      );
    });
  });

// 🔹 필터 버튼
document.getElementById('filter-all').addEventListener('click', () => {
  storageFilter = null;
  loadIngredients();
});
document.getElementById('filter-cold').addEventListener('click', () => {
  storageFilter = '냉장';
  loadIngredients();
});
document.getElementById('filter-freeze').addEventListener('click', () => {
  storageFilter = '냉동';
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

    const data = await response.json();

    let infoLine = '';
    if (data.tokens !== undefined && data.remainingFree !== undefined) {
      infoLine = `<div class="text-xs text-gray-500">📊 이번 요청 토큰: ${data.tokens}개 · 남은 무료 요청: ${data.remainingFree}회</div>`;
    }

    document.getElementById('recipes').innerHTML =
      `<div class="mt-2 text-green-700 font-semibold">🤖 AI 추천 요리: ${data.recipe}</div>` +
      infoLine +
      document.getElementById('recipes').innerHTML;
  } catch (err) {
    console.error('❌ AI 추천 오류:', err);
  }
}
