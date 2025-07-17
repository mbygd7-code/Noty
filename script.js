import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, query, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Global state ---
let app;
let db;
let auth;
let userId = null;
let cachedHistory = [];
let isHistoryReady = false;
let GEMINI_API_KEY = null; // To be fetched from the server

// --- DOM Elements ---
const childNameInput = document.getElementById('childName');
const keywordsInput = document.getElementById('keywords');
const generateBtn = document.getElementById('generateBtn');
const suggestMessageBtn = document.getElementById('suggestMessageBtn');
const reportOutput = document.getElementById('reportOutput');
const loadingSpinner = document.getElementById('loadingSpinner');
const errorMessageDiv = document.getElementById('errorMessage');
const feedbackMessage = document.getElementById('feedbackMessage');
const ageButtons = document.querySelectorAll('.age-button');
const historyIcon = document.getElementById('historyIcon');
const historyModalOverlay = document.getElementById('historyModalOverlay');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const historyListContainer = document.getElementById('historyListContainer');
const historyLoadingSpinner = document.getElementById('historyLoadingSpinner');
const noHistoryModalOverlay = document.getElementById('noHistoryModalOverlay');
const noHistoryCloseBtn = document.getElementById('noHistoryCloseBtn');
const userIdContainer = document.getElementById('userIdContainer');
const userIdText = document.getElementById('userIdText');
const historyErrorEl = document.getElementById('historyError');


// --- Main Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    showFeedbackMessage('설정 정보를 불러오는 중입니다...', 'info');
    try {
        const response = await fetch('/api/config');
        if (!response.ok) {
            throw new Error(`설정 API 호출 실패: ${response.status}`);
        }
        const config = await response.json();
        
        GEMINI_API_KEY = config.geminiApiKey;
        await initializeFirebase(config.firebaseConfig);
        
    } catch (error) {
        console.error("초기화 실패:", error);
        showFeedbackMessage('앱 초기화에 실패했습니다. 새로고침 해주세요.', 'error');
        // Disable all buttons if config fails
        generateBtn.disabled = true;
        suggestMessageBtn.disabled = true;
        historyIcon.style.opacity = '0.5';
        historyIcon.style.cursor = 'not-allowed';
    }
});


// --- Firebase Initialization ---
async function initializeFirebase(firebaseConfig) {
    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);

        auth.onAuthStateChanged(async (user) => {
            if (user) {
                userId = user.uid;
                userIdText.textContent = `사용자 ID: ${userId}`;
                console.log("Firebase authenticated. User ID:", userId);

                generateBtn.disabled = false;
                suggestMessageBtn.disabled = false;
                
                await loadInitialHistory(); // Load history after user is confirmed

            } else {
                await signInAnonymously(auth);
            }
        });
    } catch (error) {
        console.error("Firebase initialization failed:", error);
        showFeedbackMessage(`Firebase 초기화 실패: ${error.message}`, 'error');
    }
}


// --- Event Listeners ---
generateBtn.addEventListener('click', generateReport);
suggestMessageBtn.addEventListener('click', suggestAdditionalMessage);
ageButtons.forEach(button => {
    button.addEventListener('click', (event) => {
        ageButtons.forEach(btn => btn.classList.remove('active'));
        event.target.classList.add('active');
        populateKeywordsByAge(event.target.dataset.age);
    });
});
historyIcon.addEventListener('click', () => {
    if (!isHistoryReady) {
        showFeedbackMessage('기록을 로딩 중입니다. 잠시만 기다려주세요.', 'info');
        return;
    }
    historyModalOverlay.classList.add('visible');
    renderHistoryFromCache();
});
modalCloseBtn.addEventListener('click', hideHistoryModal);
historyModalOverlay.addEventListener('click', (event) => {
    if (event.target === historyModalOverlay) hideHistoryModal();
});
noHistoryCloseBtn.addEventListener('click', hideNoHistoryMessage);
noHistoryModalOverlay.addEventListener('click', (event) => {
    if (event.target === noHistoryModalOverlay) hideNoHistoryMessage();
});
userIdContainer.addEventListener('click', () => {
    const isVisible = userIdText.style.display === 'block';
    userIdText.style.display = isVisible ? 'none' : 'block';
});
historyListContainer.addEventListener('click', async (event) => {
    if (event.target.classList.contains('copy-btn')) {
        const button = event.target;
        const reportText = button.dataset.report;
        if (reportText) {
            try {
                await navigator.clipboard.writeText(reportText);
                button.textContent = '✅ 복사 완료!';
                button.classList.add('copied');
                setTimeout(() => {
                    button.textContent = '복사';
                    button.classList.remove('copied');
                }, 2000);
            } catch (err) {
                console.error('클립보드 복사 실패:', err);
            }
        }
    }
});


// --- Core Functions ---
function populateKeywordsByAge(ageGroup) {
    let keywords = '';
    switch (ageGroup) {
        case '0-2': keywords = '기어다니며 탐색함, 까꿍 놀이 즐김, 옹알이하며 의사 표현, 블록 쌓기 시도'; break;
        case '3': keywords = '친구와 함께 놀이함, 블록으로 성 만들기, 질문이 많아짐, 스스로 옷 입기 시도'; break;
        case '4': keywords = '역할 놀이에 적극 참여, 친구와 양보하며 놀이, 동화 내용 이해, 글자 모양에 관심'; break;
        case '5': keywords = '친구들과 협동하여 프로젝트 완성, 자신의 생각 논리적으로 표현, 한글에 관심 많음'; break;
        default: keywords = '';
    }
    keywordsInput.value = keywords;
}

async function generateReport() {
    if (!childNameInput.value.trim() || !keywordsInput.value.trim()) {
        errorMessageDiv.textContent = '아이 이름과 키워드를 모두 입력해주세요.';
        return;
    }
    
    loadingSpinner.style.display = 'block';
    generateBtn.disabled = true;
    suggestMessageBtn.disabled = true;
    errorMessageDiv.textContent = '';
    reportOutput.textContent = '';
    
    try {
        const prompt = `유치원 교사가 부모님께 보내는 알림장 문장을 작성해줘. 아이 이름은 "${childNameInput.value.trim()}"이고, 연령은 ${document.querySelector('.age-button.active')?.dataset.age || '정보 없음'}세이며, 오늘 있었던 일의 키워드는 다음과 같아: "${keywordsInput.value.trim()}". 연령에 맞는 발달 특성을 고려하여 자연스럽고 긍정적인 어조로 작성해줘.`;
        const generatedText = await callGeminiAPI(prompt);

        reportOutput.textContent = generatedText;

        await addDoc(collection(db, `artifacts/${app.options.appId}/users/${userId}/kindergarten_reports`), {
            childName: childNameInput.value.trim(),
            ageGroup: document.querySelector('.age-button.active')?.dataset.age || '정보 없음',
            keywords: keywordsInput.value.trim(),
            generatedReport: generatedText,
            timestamp: serverTimestamp()
        });
        
        showFeedbackMessage('✅ 알림장이 기록에 저장되었습니다!', 'success');
        loadInitialHistory(); // Refresh cache

    } catch (error) {
        console.error('알림장 생성 중 오류 발생:', error);
        errorMessageDiv.textContent = `오류가 발생했습니다: ${error.message}`;
    } finally {
        loadingSpinner.style.display = 'none';
        generateBtn.disabled = false;
        suggestMessageBtn.disabled = false;
    }
}

async function suggestAdditionalMessage() {
    if (!childNameInput.value.trim() || !keywordsInput.value.trim()) {
        errorMessageDiv.textContent = '아이 이름과 키워드를 모두 입력해주세요.';
        return;
    }

    loadingSpinner.style.display = 'block';
    generateBtn.disabled = true;
    suggestMessageBtn.disabled = true;

    try {
        const prompt = `아이 이름: "${childNameInput.value.trim()}", 연령: ${document.querySelector('.age-button.active')?.dataset.age || '정보 없음'}세, 오늘 있었던 키워드: "${keywordsInput.value.trim()}"를 바탕으로 부모님께 보낼 짧고 긍정적인 추가 메시지를 1~2문장으로 제안해줘.`;
        const suggestedMessage = await callGeminiAPI(prompt);
        reportOutput.textContent += `\n\n--- ✨ 추가 메시지 제안 ✨ ---\n${suggestedMessage}`;
    } catch (error) {
        console.error('추가 메시지 생성 중 오류 발생:', error);
        errorMessageDiv.textContent = `추가 메시지 생성 중 오류가 발생했습니다: ${error.message}`;
    } finally {
        loadingSpinner.style.display = 'none';
        generateBtn.disabled = false;
        suggestMessageBtn.disabled = false;
    }
}

async function callGeminiAPI(prompt) {
    if (!GEMINI_API_KEY) throw new Error("Gemini API 키가 로드되지 않았습니다.");

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
    const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }] };

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`API 오류: ${response.status} - ${errorData.error.message || '알 수 없는 오류'}`);
    }

    const result = await response.json();
    const generatedText = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!generatedText) throw new Error('API에서 유효한 응답을 받지 못했습니다.');
    
    return generatedText;
}


// --- History and UI Functions ---
function renderHistoryFromCache() {
    historyLoadingSpinner.style.display = 'none';
    historyListContainer.innerHTML = ''; 

    if (cachedHistory.length === 0) {
        historyListContainer.innerHTML = `<p class="history-empty-message">표시할 기록이 없습니다.</p>`;
    } else {
        cachedHistory.forEach((data) => {
            const formattedDate = formatTimestamp(data.timestamp);
            const reportText = data.generatedReport || 'N/A';
            const listItem = document.createElement('div');
            listItem.classList.add('history-item');
            listItem.innerHTML = `
                <p class="history-item-date ${!data.timestamp ? 'missing-date' : ''}">${formattedDate}</p>
                <p class="history-item-name"><strong>아이 이름:</strong> ${data.childName || 'N/A'}</p>
                <p class="history-item-keywords"><strong>키워드:</strong> ${data.keywords || 'N/A'}</p>
                <div class="history-item-report">
                    <span><strong>알림장:</strong></span>
                    <button class="copy-btn" data-report="${escapeHTML(reportText)}">복사</button>
                    <p class="report-content-text">${escapeHTML(reportText)}</p>
                </div>
            `;
            historyListContainer.appendChild(listItem);
        });
    }
}

async function loadInitialHistory() {
    if (!db || !userId) return;
    isHistoryReady = false;
    historyIcon.style.opacity = '0.5';
    historyIcon.style.cursor = 'not-allowed';
    
    try {
        const q = query(collection(db, `artifacts/${app.options.appId}/users/${userId}/kindergarten_reports`));
        const querySnapshot = await getDocs(q);
        
        const reports = [];
        querySnapshot.forEach(doc => reports.push(doc.data()));

        reports.sort((a, b) => (b.timestamp?.toMillis() || 0) - (a.timestamp?.toMillis() || 0));

        cachedHistory = reports.slice(0, 20);
        isHistoryReady = true;

        historyIcon.style.opacity = '1';
        historyIcon.style.cursor = 'pointer';
        historyIcon.title = '기록된 알림장 보기';
        historyErrorEl.style.display = 'none';
        showFeedbackMessage('✅ 준비 완료!', 'success');

    } catch (error) {
        console.error("CRITICAL: Failed to fetch and cache history:", error);
        historyIcon.title = '기록 로딩 실패';
        historyErrorEl.textContent = '오류: 기록을 불러올 수 없습니다.';
        historyErrorEl.style.display = 'block';
    }
}

function hideHistoryModal() {
    historyModalOverlay.classList.remove('visible');
}

function showNoHistoryMessage() {
    const noHistoryMessageText = document.getElementById('noHistoryMessageText');
    noHistoryMessageText.textContent = '기록된 알림장이 없습니다.';
    noHistoryModalOverlay.classList.add('visible');
}

function hideNoHistoryMessage() {
    noHistoryModalOverlay.classList.remove('visible');
}

function formatTimestamp(timestamp) {
    if (!timestamp?.toDate) return '(날짜 기록 없음)';
    const date = timestamp.toDate();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function showFeedbackMessage(message, type) {
    feedbackMessage.textContent = message;
    const colors = { success: '#10b981', error: '#ef4444', info: '#6b7280' };
    feedbackMessage.style.color = colors[type] || colors.info;

    if (type !== 'info') {
         setTimeout(() => { feedbackMessage.textContent = ''; }, 4000);
    }
}

function escapeHTML(str) {
    const p = document.createElement("p");
    p.appendChild(document.createTextNode(str));
    return p.innerHTML;
} 