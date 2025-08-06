console.log('✅ main.js loaded');

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
} from 'firebase/firestore';

// ✅ Firebase 설정 (.env에서 불러오기)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// 디버그 로그
if (import.meta.env.VITE_DEBUG === 'true') {
  console.log('Firebase Config:', firebaseConfig);
}

let app, auth, db;

try {
  // Firebase 초기화
  app = initializeApp(firebaseConfig);
  console.log('✅ Firebase initialized');

  auth = getAuth(app);
  db = getFirestore(app);
} catch (error) {
  console.error('❌ Firebase initialization error:', error);
}

let currentUser = null;

// 🔹 로그인 버튼
const loginBtn = document.getElementById('login-btn');
if (loginBtn) {
  loginBtn.addEventListener('click', async () => {
    console.log('🔹 Login button clicked');
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
  console.log('📌 Auth state changed:', user);
  if (user) {
    console.log('✅ User logged in:', user.displayName, user.email);
    currentUser = user;
    document.getElementById('login-section').innerHTML = `
      <p>👋 ${user.displayName}님 (${user.email})</p>
      <button id="logout-btn">로그아웃</button>
    `;

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        console.log('🔹 Logout button clicked');
        try {
          await signOut(auth);
        } catch (err) {
          console.error('❌ Logout error:', err);
        }
      });
      console.log('🔹 Logout button event listener added');
    }

    document.getElementById('app').style.display = 'block';
    loadIngredients();
  } else {
    console.log('ℹ️ User logged out');
    currentUser = null;
    document.getElementById(
      'login-section'
    ).innerHTML = `<button id="login-btn">Google 로그인</button>`;

    const newLoginBtn = document.getElementById('login-btn');
    if (newLoginBtn) {
      newLoginBtn.addEventListener('click', async () => {
        console.log('🔹 Login button clicked');
        const provider = new GoogleAuthProvider();
        try {
          await signInWithPopup(auth, provider);
        } catch (err) {
          console.error('❌ Login error:', err);
        }
      });
      console.log('🔹 Login button event listener added');
    }

    document.getElementById('app').style.display = 'none';
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
      myIngredients.push(item.name);
      const daysLeft = Math.ceil(
        (item.expiry.toDate() - today) / (1000 * 60 * 60 * 24)
      );
      list.innerHTML += `
        <div class="item">
          ${item.name} (${item.qty}) - 
          <span class="${daysLeft <= 3 ? 'expire-soon' : ''}">
            D${daysLeft >= 0 ? '-' + daysLeft : '+' + Math.abs(daysLeft)}
          </span>
          <button onclick="deleteIngredient('${docSnap.id}')">삭제</button>
        </div>`;
    });
    renderRecipes(myIngredients);
  });
}

// 🔹 재료 추가
document.getElementById('add-btn').addEventListener('click', async () => {
  const name = document.getElementById('name').value.trim();
  const qty = parseInt(document.getElementById('qty').value);
  const expiry = document.getElementById('expiry').value;
  if (!name || !qty || !expiry) return alert('모든 칸을 채워주세요.');

  try {
    await addDoc(collection(db, 'users', currentUser.uid, 'ingredients'), {
      name,
      qty,
      expiry: Timestamp.fromDate(new Date(expiry)),
    });
  } catch (err) {
    console.error('❌ Add ingredient error:', err);
  }

  document.getElementById('name').value = '';
  document.getElementById('qty').value = '';
  document.getElementById('expiry').value = '';
});

// 🔹 재료 삭제
window.deleteIngredient = async (id) => {
  try {
    await deleteDoc(doc(db, 'users', currentUser.uid, 'ingredients', id));
  } catch (err) {
    console.error('❌ Delete ingredient error:', err);
  }
};

// 🔹 레시피 추천
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
