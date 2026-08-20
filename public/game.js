const socket = io();


// --- الإعدادات + التحديات + XP ---
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('settingsModal');
    const openBtn = document.getElementById('openSettingsBtn');
    const closeBtn = document.getElementById('closeSettingsBtn');
    const saveBtn = document.getElementById('saveSettingsBtn');
    const challengesModal = document.getElementById('challengesModal');
    const openChallengesBtn = document.getElementById('openChallengesBtn');
    const closeChallengesBtn = document.getElementById('closeChallengesBtn');

    openBtn?.addEventListener('click', () => {
        // من داخل اللوبي: افتح الإعدادات المتقدمة في صفحة مستقلة.
        // من الصفحة الرئيسية: افتح نفس نافذة الإعدادات المعتادة.
        if (typeof currentRoom !== 'undefined' && currentRoom) {
            openLobbySettingsPage();
            return;
        }
        modal?.classList.remove('hidden');
    });
    closeBtn?.addEventListener('click', () => modal?.classList.add('hidden'));
    saveBtn?.addEventListener('click', () => { saveChatSettings(); modal?.classList.add('hidden'); });

    document.getElementById('closeLobbyProfileBtn')?.addEventListener('click', closeLobbyProfileEditor);
    document.getElementById('saveLobbyProfileBtn')?.addEventListener('click', saveLobbyProfileChanges);
    openChallengesBtn?.addEventListener('click', () => {
        const profile = getGoogleProfile();
        if (!profile?.email && !profile?.sub) {
            challengesModal?.classList.add('hidden');
            modal?.classList.remove('hidden');
            const status = document.getElementById('googleLoginStatus');
            if (status) status.textContent = '🔒 يجب تسجيل الدخول بحساب Google أولاً لفتح التحديات.';
            return;
        }
        challengesModal?.classList.remove('hidden');
        requestProgress();
    });
    closeChallengesBtn?.addEventListener('click', () => challengesModal?.classList.add('hidden'));

    document.getElementById('dailyChallengesTab')?.addEventListener('click', () => switchChallengeTab('daily'));
    document.getElementById('weeklyChallengesTab')?.addEventListener('click', () => switchChallengeTab('weekly'));

    const ids = ['chatTextScale','chatMessageScale','chatWidth','chatHeight','chatAvatarScale'];
    ids.forEach(id => document.getElementById(id+'Range')?.addEventListener('input', () => applyChatSettings(false)));
    loadChatSettings();

    // إذا فتحت الإعدادات من اللوبي، اجعلها صفحة مستقلة في هذا التبويب الجديد.
    const settingsPageMode = new URLSearchParams(window.location.search).get("settings") === "lobby";
    if (settingsPageMode) {
        document.body.classList.add("settings-page-mode");
        modal?.classList.remove("hidden");
        document.getElementById("settingsPageNotice")?.classList.remove("hidden");
    }

});

function openLobbySettingsPage() {
    // افتح نسخة مستقلة حتى تبقى الصفحة الرئيسية/إعداداتها كما هي.
    const url = new URL(window.location.href);
    url.searchParams.set("settings", "lobby");
    window.open(url.toString(), "_blank", "noopener,noreferrer");
}

function applyChatSettings(updateLabels = true) {
    const get = id => Number(document.getElementById(id+'Range')?.value || 100);
    const root = document.documentElement;
    const text = get('chatTextScale');
    const message = get('chatMessageScale');
    const width = get('chatWidth');
    const height = get('chatHeight');
    const avatar = get('chatAvatarScale');

    root.style.setProperty('--chat-text-scale', text / 100);
    root.style.setProperty('--chat-message-scale', message / 100);
    root.style.setProperty('--chat-width-scale', width / 100);
    root.style.setProperty('--chat-height-scale', height / 100);
    root.style.setProperty('--chat-avatar-scale', avatar / 100);

    if (updateLabels) updateChatSettingLabels();
}

function updateChatSettingLabels() {
    const map = [
        ['chatTextScale','%'],
        ['chatMessageScale','%'],
        ['chatWidth','%'],
        ['chatHeight','%'],
        ['chatAvatarScale','%']
    ];
    map.forEach(([id, suffix]) => {
        const r = document.getElementById(id+'Range');
        const v = document.getElementById(id+'Val');
        if (r && v) v.textContent = r.value + suffix;
    });
}

function saveChatSettings() {
    const ids = ['chatTextScale','chatMessageScale','chatWidth','chatHeight','chatAvatarScale'];
    const settings = {};
    ids.forEach(id => settings[id] = document.getElementById(id+'Range')?.value || 100);
    localStorage.setItem('secretIdentity_chatSettings', JSON.stringify(settings));
    applyChatSettings();
}

function loadChatSettings() {
    let data = {};
    try { data = JSON.parse(localStorage.getItem('secretIdentity_chatSettings') || '{}'); } catch (_) {}
    const ids = ['chatTextScale','chatMessageScale','chatWidth','chatHeight','chatAvatarScale'];
    ids.forEach(id => {
        const r = document.getElementById(id+'Range');
        if (r) r.value = data[id] ?? 100;
    });
    applyChatSettings();
}

function resetChatSettings() {
    const ids = ['chatTextScale','chatMessageScale','chatWidth','chatHeight','chatAvatarScale'];
    ids.forEach(id => {
        const r = document.getElementById(id+'Range');
        if (r) r.value = 100;
    });
    saveChatSettings();
}

function updateProfileUI(level, xp) {

    const levelElem=document.getElementById('current-level'), xpElem=document.getElementById('current-xp'), bar=document.getElementById('xp-bar');
    if(levelElem)levelElem.textContent=level||1; if(xpElem)xpElem.textContent=xp||0;
    const need=Math.min(800,Math.max(100,(Number(level)||1)*100)); if(bar)bar.style.width=Math.min(100,Math.max(0,(Number(xp||0)/need)*100))+'%';
}
function getGoogleProfile(){try{return JSON.parse(localStorage.getItem('si_googleProfile')||'null')}catch(_){return null}}
function requestProgress(){const p=getGoogleProfile();if(p?.email||p?.sub)socket.emit('getProgress',{accountId:p.email||p.sub,email:p.email||''});}
function renderChallenges(data){
    const render=(list,id)=>{
        const box=document.getElementById(id);
        if(!box)return;
        box.innerHTML=(list||[]).map(c=>{
            const progress=Math.min(Number(c.progress||0), Number(c.target||1));
            const percent=Math.min(100, progress/Math.max(1,Number(c.target||1))*100);
            return `<article class="challenge-item ${c.completed?'done':''}">
                <div class="challenge-top"><strong>${c.completed?'✅':'🎯'} ${escapeHtml(c.title||'تحدي')}</strong><span class="challenge-reward">+${Number(c.reward||0)} XP</span></div>
                <div class="challenge-desc">${escapeHtml(c.description||'أكمل الهدف لتحصل على XP.')}</div>
                <div class="challenge-meta"><span>${progress} / ${c.target}</span><span>${c.completed?'مكتمل':'قيد التقدم'}</span></div>
                <div class="challenge-progress-bar"><div class="challenge-progress-fill" style="width:${percent}%"></div></div>
            </article>`;
        }).join('')||'<div class="challenge-item">لا توجد تحديات حالياً.</div>';
    };
    render(data.daily||[],'dailyChallengesList');
    render(data.weekly||[],'weeklyChallengesList');
    updateProfileUI(data.level,data.xp);
    updateAccountUI();
}
function switchChallengeTab(tab){
    document.getElementById('dailyChallengesList')?.classList.toggle('hidden',tab!=='daily');document.getElementById('weeklyChallengesList')?.classList.toggle('hidden',tab!=='weekly');
    document.getElementById('dailyChallengesTab')?.classList.toggle('active',tab==='daily');document.getElementById('weeklyChallengesTab')?.classList.toggle('active',tab==='weekly');
}
socket.on('progressUpdated', renderChallenges);
socket.on('profileProgress', renderChallenges);

// ================= AUDIO SYSTEM =================
// الأصوات مولّدة محلياً عبر Web Audio API، لذلك لا تحتاج ملفات صوتية خارجية.
const AudioManager = (() => {
    let ctx = null;
    let sfxVolume = Number(localStorage.getItem("si_sfxVolume") ?? 0.75);
    let ambienceVolume = Number(localStorage.getItem("si_ambienceVolume") ?? 0.25);
    let muted = localStorage.getItem("si_muted") === "1";
    let lastTick = -1;

    function ensure() {
        if (!ctx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return null;
            ctx = new Ctx();
        }
        if (ctx.state === "suspended") ctx.resume();
        return ctx;
    }

    function tone(freq, duration, type="sine", gain=0.12, delay=0, endFreq=null) {
        if (muted) return;
        const c = ensure();
        if (!c) return;
        const now = c.currentTime + delay;
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, now);
        if (endFreq) o.frequency.exponentialRampToValueAtTime(Math.max(20,endFreq), now + duration);
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain * sfxVolume), now + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        o.connect(g).connect(c.destination);
        o.start(now);
        o.stop(now + duration + 0.03);
    }

    function noise(duration=0.18, gain=0.08, delay=0) {
        if (muted) return;
        const c = ensure();
        if (!c) return;
        const len = Math.floor(c.sampleRate * duration);
        const buffer = c.createBuffer(1, len, c.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i=0;i<len;i++) data[i] = (Math.random()*2-1) * (1-i/len);
        const src = c.createBufferSource();
        const filter = c.createBiquadFilter();
        const g = c.createGain();
        const now = c.currentTime + delay;
        filter.type = "bandpass"; filter.frequency.value = 1100; filter.Q.value = 0.7;
        g.gain.value = gain * sfxVolume;
        src.buffer = buffer; src.connect(filter).connect(g).connect(c.destination);
        src.start(now);
    }

    function play(name) {
        switch(name) {
            case "click": tone(620,.07,"sine",.08); break;
            case "join": tone(440,.08,"sine",.08); tone(660,.13,"sine",.1,.08); break;
            case "phase": tone(392,.12,"triangle",.09); tone(523,.16,"triangle",.1,.11); break;
            case "vote": tone(330,.12,"triangle",.1); tone(494,.18,"triangle",.1,.12); break;
            case "lock": tone(740,.08,"square",.07); tone(980,.12,"sine",.08,.07); break;
            case "tick": tone(880,.07,"square",.07); break;
            case "warning": tone(220,.18,"sawtooth",.09,0,150); tone(180,.18,"sawtooth",.08,.2,120); break;
            case "round": tone(260,.2,"triangle",.1); tone(196,.35,"triangle",.12,.2,110); break;
            case "elimination": noise(.12,.07); tone(180,.5,"sawtooth",.13,0,65); break;
            case "final": tone(220,.16,"triangle",.09); tone(277,.16,"triangle",.09,.16); tone(330,.22,"triangle",.1,.32); break;
            case "suspense":
                tone(130,.35,"sine",.08); tone(155,.35,"sine",.08,.38); tone(185,.35,"sine",.08,.76);
                break;
            case "reveal": tone(523,.12,"triangle",.09); tone(659,.12,"triangle",.1,.12); tone(784,.28,"triangle",.12,.24); break;
            case "correct": tone(523,.1,"sine",.1); tone(659,.1,"sine",.1,.1); tone(1046,.3,"sine",.12,.2); break;
            case "wrong": tone(220,.2,"sawtooth",.1,0,130); tone(165,.35,"sawtooth",.1,.2,90); break;
            case "victory": [523,659,784,1046].forEach((f,i)=>tone(f,.28,"triangle",.12,i*.12)); break;
            case "retry": tone(330,.15,"triangle",.09); tone(220,.25,"triangle",.08,.15); break;
        }
    }

    function onTimer(seconds) {
        if (seconds === 10 || seconds === 5 || seconds === 3 || seconds === 2 || seconds === 1) {
            if (lastTick !== seconds) { lastTick = seconds; play("tick"); }
        }
        if (seconds > 10) lastTick = -1;
    }

    return {
        play, onTimer,
        unlock: ensure,
        setSfxVolume(v){ sfxVolume=Number(v)/100; localStorage.setItem("si_sfxVolume",sfxVolume); },
        setAmbienceVolume(v){ ambienceVolume=Number(v)/100; localStorage.setItem("si_ambienceVolume",ambienceVolume); },
        toggleMute(){ muted=!muted; localStorage.setItem("si_muted",muted?"1":"0"); return muted; },
        isMuted(){ return muted; },
        getSfx(){ return Math.round(sfxVolume*100); },
        getAmbience(){ return Math.round(ambienceVolume*100); }
    };
})();

function toggleSoundPanel() {
    document.getElementById("soundControls").classList.toggle("hidden");
}
function setSfxVolume(v) { AudioManager.setSfxVolume(v); }
function setAmbienceVolume(v) { AudioManager.setAmbienceVolume(v); }
function toggleMute() {
    const muted = AudioManager.toggleMute();
    document.getElementById("muteSoundBtn").textContent = muted ? "🔊 تشغيل الصوت" : "🔇 كتم الصوت";
    document.getElementById("soundToggle").textContent = muted ? "🔇 الصوت" : "🔊 الصوت";
}
window.addEventListener("pointerdown", () => AudioManager.unlock(), { once:true });
window.addEventListener("keydown", () => AudioManager.unlock(), { once:true });

document.addEventListener("DOMContentLoaded", () => {
    restoreProfile();
    initGoogleLogin();
    updateAccountUI();

    const real = document.getElementById("realName");
    const nick = document.getElementById("nickName");
    if (real) real.addEventListener("input", saveProfile);
    if (nick) nick.addEventListener("input", saveProfile);

    const s = document.getElementById("sfxVolume"), a = document.getElementById("ambienceVolume");
    if (s) s.value = AudioManager.getSfx();
    if (a) a.value = AudioManager.getAmbience();
    const muted = AudioManager.isMuted();
    const m = document.getElementById("muteSoundBtn"), t = document.getElementById("soundToggle");
    if (m) m.textContent = muted ? "🔊 تشغيل الصوت" : "🔇 كتم الصوت";
    if (t) t.textContent = muted ? "🔇 الصوت" : "🔊 الصوت";
});

// --- 1. استرجاع بيانات المستخدم تلقائياً عند فتح الصفحة ---
window.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('secretIdentity_user');
    if (savedUser) {
        try {
            const userData = JSON.parse(savedUser);
            if (document.getElementById('realName')) document.getElementById('realName').value = userData.realName || '';
            if (document.getElementById('nickName')) document.getElementById('nickName').value = userData.nickName || '';
            
            // تحديث واجهة الـ XP والمستوى
            updateProfileUI(userData.level || 1, userData.xp || 0);
        } catch (e) {
            console.error("خطأ في قراءة بيانات الجلسة المخزنة", e);
        }
    }
});

// --- 2. دالة تحديث شريط الـ XP والمستوى في الواجهة ---
function updateProfileUI(level, xp) {
    const levelElem = document.getElementById('current-level');
    const xpElem = document.getElementById('current-xp');
    const xpBar = document.getElementById('xp-bar');
    const nextXpElem = document.getElementById('next-level-xp');

    if (levelElem) levelElem.innerText = level;
    if (xpElem) xpElem.innerText = xp;
    const need = Math.min(800, Math.max(100, (Number(level) || 1) * 100));
    if (nextXpElem) nextXpElem.innerText = need;
    if (xpBar) {
        let need = Math.min(800, Math.max(100, (Number(level)||1) * 100));
        let percent = Math.min(100, Math.max(0, (Number(xp||0) / need) * 100));
        xpBar.style.width = percent + '%';
    }
}

// --- 3. دالة حفظ الجلسة ---
function saveUserSession(realName, nickName, avatar) {
    const existingData = JSON.parse(localStorage.getItem('secretIdentity_user') || '{}');
    const userData = {
        realName: realName || existingData.realName || '',
        nickName: nickName || existingData.nickName || '',
        avatar: avatar || existingData.avatar || '',
        level: existingData.level || 1,
        xp: existingData.xp || 0
    };
    localStorage.setItem('secretIdentity_user', JSON.stringify(userData));
}


async function initGoogleLogin() {
    const container = document.getElementById("googleSignInButton");
    const status = document.getElementById("googleLoginStatus");
    if (!container) return;

    try {
        const response = await fetch("/google-client-config");
        const config = await response.json();

        if (!config.clientId) {
            if (status) status.textContent = "لتفعيل دخول Google: ضع GOOGLE_CLIENT_ID في إعدادات السيرفر.";
            return;
        }

        const waitForGoogle = () => {
            if (!window.google?.accounts?.id) {
                setTimeout(waitForGoogle, 200);
                return;
            }

            google.accounts.id.initialize({
                client_id: config.clientId,
                callback: handleGoogleCredential
            });

            window.renderGoogleLoginButton = () => {
                if (!window.google?.accounts?.id || !container) return;
                container.innerHTML = "";
                google.accounts.id.renderButton(container, {
                    theme: getGoogleButtonTheme(),
                    size: "large",
                    text: "signin_with",
                    shape: "pill",
                    width: 320,
                    locale: "ar"
                });
            };
            window.renderGoogleLoginButton();
        };

        waitForGoogle();
    } catch (error) {
        if (status) status.textContent = "تعذر تجهيز تسجيل الدخول بحساب Google.";
    }
}


function getGoogleButtonTheme() {
    const theme = document.documentElement.getAttribute("data-theme") || "default";
    return ["dark", "matrix", "neon", "blue", "red", "cyan", "pink", "orange", "gold"].includes(theme)
        ? "filled_black"
        : "outline";
}

function decodeGoogleCredential(credential) {
    const payload = credential.split(".")[1];
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(atob(base64).split("").map(c =>
        "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)
    ).join(""));
    return JSON.parse(json);
}

function handleGoogleCredential(response) {
    try {
        const profile = decodeGoogleCredential(response.credential);
        const real = document.getElementById("realName");
        const nick = document.getElementById("nickName");

        if (real && !real.value.trim()) real.value = profile.name || "";
        if (nick && !nick.value.trim()) nick.value = profile.given_name || profile.name || "";

        if (profile.picture) {
            currentAvatarData = profile.picture;
            restoreAvatarVisual(profile.picture);
        }

        localStorage.setItem("si_googleProfile", JSON.stringify({
            sub: profile.sub || "",
            email: profile.email || "",
            name: profile.name || "",
            picture: profile.picture || ""
        }));

        saveProfile();
        socket.emit('registerAccount', { accountId: profile.email || profile.sub, email: profile.email || '', name: profile.name || '' });
        requestProgress();

        const status = document.getElementById("googleLoginStatus");
        if (status) status.textContent = `✅ تم تسجيل الدخول بحساب Google: ${profile.name || ""}`;
    } catch (error) {
        showError("تعذر قراءة بيانات حساب Google.");
    }
}

function updateAccountUI() {
    const profile = getGoogleProfile();
    const status = document.getElementById("googleLoginStatus");
    const logoutBtn = document.getElementById("googleLogoutBtn");
    if (profile?.email || profile?.sub) {
        if (status) status.textContent = `✅ مسجل: ${profile.email || profile.name || 'حساب Google'}`;
        if (logoutBtn) logoutBtn.classList.remove("hidden");
    } else {
        if (status && !status.textContent.includes("لتفعيل")) status.textContent = "غير مسجل بحساب Google";
        if (logoutBtn) logoutBtn.classList.add("hidden");
    }
}

function logoutGoogleAccount() {
    if (currentRoom) return showToast("⚠️ اخرج من الغرفة أولاً ثم سجّل الخروج.", "warning");
    try {
        if (window.google?.accounts?.id?.disableAutoSelect) google.accounts.id.disableAutoSelect();
        if (window.google?.accounts?.id?.revoke) {
            const profile = getGoogleProfile();
            if (profile?.email) google.accounts.id.revoke(profile.email, () => {});
        }
    } catch (_) {}
    localStorage.removeItem("si_googleProfile");
    updateAccountUI();
    updateProfileUI(1, 0);
    const status = document.getElementById("googleLoginStatus");
    if (status) status.textContent = "🚪 تم تسجيل الخروج. يمكنك تسجيل الدخول بحساب Google آخر.";
    showToast("🚪 تم تسجيل الخروج من حساب Google.", "success");
}

console.log("Secret Identity جاهزة 🎭");

let currentRoom = "";
let isHost = false;
let myNickName = "";
let myRealName = "";
let submittedVote = false;
let isSpectator = false;
let resultCountdownInterval = null;
let suspenseCountdownInterval = null;
let currentAvatarData = "#ef4444";
let chatMembers = [];

const PROFILE_STORAGE_KEY = "si_playerProfile";
const LOBBY_SESSION_KEY = "si_lobbySession";
const PLAYER_KEY_STORAGE_KEY = "si_playerKey";

function getPlayerKey() {
    let key = localStorage.getItem(PLAYER_KEY_STORAGE_KEY);
    if (!key) {
        key = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
        localStorage.setItem(PLAYER_KEY_STORAGE_KEY, key);
    }
    return key;
}

const playerKey = getPlayerKey();

function saveProfile() {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({
        realName: document.getElementById("realName")?.value.trim() || myRealName,
        nickName: document.getElementById("nickName")?.value.trim() || myNickName,
        avatar: currentAvatarData
    }));
}

function saveLobbySession() {
    if (!currentRoom) return;
    localStorage.setItem(LOBBY_SESSION_KEY, JSON.stringify({
        roomCode: currentRoom,
        playerKey,
        realName: myRealName,
        nickName: myNickName,
        avatar: currentAvatarData
    }));
}

function clearLobbySession() {
    localStorage.removeItem(LOBBY_SESSION_KEY);
}

function restoreProfile() {
    try {
        const saved = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || "null");
        if (!saved) return;

        const real = document.getElementById("realName");
        const nick = document.getElementById("nickName");
        if (real && saved.realName) real.value = saved.realName;
        if (nick && saved.nickName) nick.value = saved.nickName;

        if (saved.avatar) {
            currentAvatarData = saved.avatar;
            restoreAvatarVisual(saved.avatar);
        }
    } catch (_) {}
}

function restoreAvatarVisual(data) {
    document.querySelectorAll(".avatar-circle").forEach(el => el.classList.remove("selected"));

    const preset = [...document.querySelectorAll(".avatar-circle")].find(el =>
        el.style.backgroundColor && el.style.backgroundColor.toLowerCase() === String(data).toLowerCase()
    );

    if (preset) {
        preset.classList.add("selected");
        return;
    }

    const section = document.querySelector(".avatar-section");
    const label = document.querySelector(".custom-avatar-label");
    if (!section || !label) return;

    let custom = section.querySelector(".saved-avatar");
    if (!custom) {
        custom = document.createElement("div");
        custom.className = "avatar-circle selected saved-avatar";
        section.insertBefore(custom, label);
    }
    custom.style.backgroundImage = /^https?:\/\//i.test(data) || String(data).startsWith("data:image") ? `url("${String(data).replace(/"/g, '\\"')}")` : "";
    if (!custom.style.backgroundImage) custom.style.backgroundColor = data;
}


function selectAvatar(element, data) {
    document.querySelectorAll(".avatar-circle").forEach(el => el.classList.remove("selected"));
    element.classList.add("selected");
    currentAvatarData = data;
    saveProfile();
}

function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = function(e) {
        const img = new Image();

        img.onload = function() {
            const canvas = document.createElement("canvas");
            canvas.width = 100;
            canvas.height = 100;

            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, 100, 100);

            currentAvatarData = canvas.toDataURL("image/jpeg", 0.7);
            saveProfile();

            const customDiv = document.createElement("div");
            customDiv.className = "avatar-circle selected";
            customDiv.style.backgroundImage = `url(${currentAvatarData})`;
            customDiv.onclick = function() {
                selectAvatar(this, currentAvatarData);
            };

            document.querySelectorAll(".avatar-circle").forEach(el => el.classList.remove("selected"));

            document
                .querySelector(".avatar-section")
                .insertBefore(customDiv, document.querySelector(".custom-avatar-label"));
        };

        img.src = e.target.result;
    };

    reader.readAsDataURL(file);
}


function openPinterestPicker() {
    const modal = document.getElementById("pinterestPicker");
    if (!modal) return;

    // اجعل نافذة Pinterest أعلى من أي نافذة أخرى حتى تعمل من اللوبي أو الصفحة الرئيسية.
    modal.classList.remove("hidden");
    modal.style.zIndex = "10050";

    const input = document.getElementById("pinterestImageUrl");
    const error = document.getElementById("pinterestError");
    const preview = document.getElementById("pinterestPreview");
    if (error) error.textContent = "";
    if (preview) preview.classList.add("hidden");
    if (input) {
        input.value = "";
        input.focus();
        input.removeEventListener("input", previewPinterestImage);
        input.addEventListener("input", previewPinterestImage);
    }
}

function closePinterestPicker() {
    const modal = document.getElementById("pinterestPicker");
    if (modal) modal.classList.add("hidden");

    const error = document.getElementById("pinterestError");
    if (error) error.textContent = "";
}

function openPinterest() {
    window.open("https://www.pinterest.com/", "_blank", "noopener,noreferrer");
}

function isPinterestPageUrl(url) {
    try {
        const u = new URL(url);
        const host = u.hostname.toLowerCase().replace(/^www\./, "");
        return host === "pinterest.com" || host.endsWith(".pinterest.com") || host === "pin.it";
    } catch (_) { return false; }
}

let pinterestResolveTimer = null;
let pinterestResolvedImageUrl = "";

async function previewPinterestImage() {
    const input = document.getElementById("pinterestImageUrl");
    const preview = document.getElementById("pinterestPreview");
    const image = document.getElementById("pinterestPreviewImage");
    const error = document.getElementById("pinterestError");
    if (!input || !preview || !image) return;
    const url = input.value.trim();
    pinterestResolvedImageUrl = "";
    if (!url) { preview.classList.add("hidden"); if (error) error.textContent = ""; return; }
    if (!/^https?:\/\/\S+$/i.test(url)) {
        preview.classList.add("hidden");
        if (error) error.textContent = "ألصق رابط Pinterest أو رابط صورة صحيح يبدأ بـ https://";
        return;
    }
    if (isPinterestPageUrl(url)) {
        if (error) error.textContent = "⏳ جارٍ جلب صورة الـPin...";
        clearTimeout(pinterestResolveTimer);
        pinterestResolveTimer = setTimeout(async () => {
            try {
                const res = await fetch("/api/pinterest-resolve", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ url })
                });
                const data = await res.json();
                if (!res.ok || !data?.imageUrl) {
                    preview.classList.add("hidden");
                    if (error) error.textContent = data?.error || "تعذر العثور على صورة داخل رابط Pinterest.";
                    return;
                }
                pinterestResolvedImageUrl = data.imageUrl;
                image.onload = () => {
                    preview.classList.remove("hidden");
                    if (error) error.textContent = "✅ تم العثور على الصورة. اضغط «استخدام الصورة».";
                };
                image.onerror = () => {
                    preview.classList.add("hidden");
                    if (error) error.textContent = "تعذر تحميل الصورة التي وجدها Pinterest.";
                };
                image.referrerPolicy = "no-referrer";
                image.src = data.imageUrl;
            } catch (_) {
                preview.classList.add("hidden");
                if (error) error.textContent = "تعذر الاتصال بخادم Pinterest. جرّب رابط صورة مباشر.";
            }
        }, 250);
        return;
    }
    image.onload = () => {
        pinterestResolvedImageUrl = url;
        preview.classList.remove("hidden");
        if (error) error.textContent = "✅ تمت معاينة الصورة.";
    };
    image.onerror = () => {
        pinterestResolvedImageUrl = "";
        preview.classList.add("hidden");
        if (error) error.textContent = "هذا الرابط لا يعرض صورة مباشرة. يمكنك أيضاً لصق رابط الـPin نفسه وسأحاول استخراج الصورة.";
    };
    image.referrerPolicy = "no-referrer";
    image.src = url;
}
function usePinterestImage() {
    const input = document.getElementById("pinterestImageUrl");
    const image = document.getElementById("pinterestPreviewImage");
    const error = document.getElementById("pinterestError");
    const rawUrl = input ? input.value.trim() : "";
    const url = pinterestResolvedImageUrl || rawUrl;
    if (!url || !/^https?:\/\/\S+$/i.test(url)) {
        if (error) error.textContent = "ألصق رابط Pinterest أو رابط الصورة أولاً.";
        return;
    }
    if (!image || !image.complete || !image.naturalWidth) {
        if (error) error.textContent = "لم تُجهّز الصورة بعد. انتظر ظهور المعاينة ثم اضغط «استخدام الصورة».";
        return;
    }
    currentAvatarData = url;
    saveProfile();
    document.querySelectorAll(".avatar-circle").forEach(el => el.classList.remove("selected"));
    const customDiv = document.createElement("div");
    customDiv.className = "avatar-circle selected pinterest-selected-avatar";
    customDiv.style.backgroundImage = `url("${url.replace(/"/g, '\\"')}")`;
    const pinterestAvatarUrl = url;
    customDiv.onclick = function() { selectAvatar(this, pinterestAvatarUrl); };
    const section = document.querySelector(".avatar-section");
    const label = document.querySelector(".custom-avatar-label");
    if (section && label) {
        const previous = section.querySelector(".pinterest-selected-avatar");
        if (previous) previous.remove();
        section.insertBefore(customDiv, label);
    }
    const lobbySection = document.querySelector(".lobby-avatar-section");
    const lobbyLabel = lobbySection?.querySelector(".custom-avatar-label");
    if (lobbySection && lobbyLabel) {
        const previousLobby = lobbySection.querySelector(".pinterest-selected-avatar");
        if (previousLobby) previousLobby.remove();
        const lobbyDiv = document.createElement("div");
        lobbyDiv.className = "avatar-circle selected pinterest-selected-avatar";
        lobbyDiv.style.backgroundImage = `url("${url.replace(/"/g, '\\"')}")`;
        const lobbyPinterestAvatarUrl = url;
        lobbyDiv.onclick = function() { selectLobbyAvatar(this, lobbyPinterestAvatarUrl); };
        lobbySection.insertBefore(lobbyDiv, lobbyLabel);
    }
    closePinterestPicker();
    if (!document.getElementById("lobbyProfileModal")?.classList.contains("hidden")) restoreLobbyAvatarVisual(currentAvatarData);
}
document.addEventListener("keydown", event => {
    if (event.key === "Escape") closePinterestPicker();
});

function getAvatarElement(data) {
    const div = document.createElement("div");
    div.className = "mini-avatar";

    if (data && data.startsWith("data:image")) {
        div.style.backgroundImage = `url(${data})`;
    } else if (data && /^https?:\/\//i.test(data)) {
        div.style.backgroundImage = `url("${data.replace(/"/g, '\\"')}")`;
    } else {
        div.style.backgroundColor = data || "#3b3156";
    }

    return div;
}

function setTheme(theme) {
    if (theme) {
        document.documentElement.setAttribute("data-theme", theme);
        localStorage.setItem("secretIdentityTheme", theme);
    } else {
        document.documentElement.removeAttribute("data-theme");
        localStorage.removeItem("secretIdentityTheme");
    }
    // أعد رسم زر Google حتى يتوافق لونه مع الثيم الحالي.
    if (typeof window.renderGoogleLoginButton === 'function') window.renderGoogleLoginButton();
}

const savedTheme = localStorage.getItem("secretIdentityTheme");
if (savedTheme) setTheme(savedTheme);

function showScreen(id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    const screen = document.getElementById(id);
    if (screen) screen.classList.add("active");
}

function updateMyPlayerTag() {
    document.getElementById("myPlayerTag").innerHTML =
        `👤 الاسم الحقيقي: <span class="real">${escapeHtml(myRealName)}</span>
         &nbsp;|&nbsp;
         الاسم المستعار: <span class="nick">${escapeHtml(myNickName)}</span>`;
}

function openLobbyProfileEditor() {
    const modal = document.getElementById("lobbyProfileModal");
    const nick = document.getElementById("lobbyNickNameInput");
    if (!modal || !currentRoom) return;
    if (nick) nick.value = myNickName || "";
    restoreLobbyAvatarVisual(currentAvatarData);
    modal.classList.remove("hidden");
}

function closeLobbyProfileEditor() {
    document.getElementById("lobbyProfileModal")?.classList.add("hidden");
}

function restoreLobbyAvatarVisual(data) {
    const section = document.querySelector("#lobbyProfileModal .lobby-avatar-section");
    const preview = document.getElementById("lobbyAvatarPreview");
    if (!section) return;
    section.querySelectorAll(".avatar-circle").forEach(el => el.classList.remove("selected"));
    const preset = [...section.querySelectorAll(".avatar-circle")].find(el => {
        const bg = (el.style.backgroundColor || "").toLowerCase();
        return bg && bg === String(data || "").toLowerCase();
    });
    if (preset) preset.classList.add("selected");

    if (preview) {
        preview.innerHTML = "";
        const el = getAvatarElement(data || "#3b3156");
        el.classList.add("lobby-avatar-preview-image");
        preview.appendChild(el);
    }
}

function selectLobbyAvatar(element, data) {
    const section = document.querySelector("#lobbyProfileModal .lobby-avatar-section");
    if (section) section.querySelectorAll(".avatar-circle").forEach(el => el.classList.remove("selected"));
    element?.classList.add("selected");
    currentAvatarData = data;
    restoreLobbyAvatarVisual(currentAvatarData);
}

function handleLobbyImageUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
        showToast("📷 الصورة كبيرة جداً. الحد الأقصى 5MB.", "warning");
        event.target.value = "";
        return;
    }
    const reader = new FileReader();
    reader.onload = e => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = 100; canvas.height = 100;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, 100, 100);
            currentAvatarData = canvas.toDataURL("image/jpeg", 0.7);
            restoreLobbyAvatarVisual(currentAvatarData);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function saveLobbyProfileChanges() {
    if (!currentRoom) return;
    const nick = document.getElementById("lobbyNickNameInput")?.value.trim();
    if (!nick) return showToast("اكتب اسماً مستعاراً أولاً.", "warning");
    if (nick.length > 20) return showToast("الاسم المستعار طويل جداً.", "warning");
    socket.emit("updateLobbyProfile", {
        roomCode: currentRoom,
        nickName: nick,
        avatar: currentAvatarData
    });
}

function returnToLobbyFromResult() {
    if (!currentRoom) return leaveToHome();
    socket.emit("requestReturnToLobby", { roomCode: currentRoom });
}

function createRoom() {
    const realName = document.getElementById("realName").value.trim();
    const nickName = document.getElementById("nickName").value.trim();

    if (!realName || !nickName) {
        return showError("أدخل اسمك الحقيقي والمستعار.");
    }

    myNickName = nickName;
    myRealName = realName;
    saveProfile();

    socket.emit("createRoom", {
        realName,
        nickName,
        avatar: currentAvatarData,
        playerKey,
        accountId: getGoogleProfile()?.email || getGoogleProfile()?.sub || '',
        email: getGoogleProfile()?.email || ''
    });
}

function joinRoom() {
    const realName = document.getElementById("realName").value.trim();
    const nickName = document.getElementById("nickName").value.trim();
    const roomCode = document.getElementById("roomCodeInput").value.trim();

    if (!realName || !nickName || !roomCode) {
        return showError("أكمل جميع بيانات الانضمام.");
    }

    myNickName = nickName;
    myRealName = realName;
    saveProfile();

    socket.emit("joinRoom", {
        roomCode,
        realName,
        nickName,
        avatar: currentAvatarData,
        playerKey,
        accountId: getGoogleProfile()?.email || getGoogleProfile()?.sub || '',
        email: getGoogleProfile()?.email || ''
    });
}

socket.on("connect", () => {
    try {
        const session = JSON.parse(localStorage.getItem(LOBBY_SESSION_KEY) || "null");
        if (!session || !session.roomCode) return;

        currentRoom = session.roomCode;
        myRealName = session.realName || myRealName;
        myNickName = session.nickName || myNickName;
        currentAvatarData = session.avatar || currentAvatarData;

        socket.emit("reconnectRoom", {
            roomCode: session.roomCode,
            playerKey: session.playerKey || playerKey
        });
        requestProgress();
    } catch (_) {}
});

socket.on("roomCreated", data => {
    currentRoom = data.roomCode;
    isHost = true;
    saveLobbySession();

    document.getElementById("roomCodeDisplay").textContent = currentRoom;
    document.getElementById("hostControls").classList.remove("hidden");
    document.getElementById("hostSettings").classList.remove("hidden");

    updateMyPlayerTag();
    showScreen("lobbyScreen");
});

socket.on("joinedSuccess", data => {
    currentRoom = data.roomCode;
    isHost = !!data.isHost;
    saveLobbySession();

    document.getElementById("roomCodeDisplay").textContent = currentRoom;
    updateMyPlayerTag();
    showScreen("lobbyScreen");
});

socket.on("reconnectedToRoom", data => {
    currentRoom = data.roomCode;
    myRealName = data.realName || myRealName;
    myNickName = data.nickName || myNickName;
    currentAvatarData = data.avatar || currentAvatarData;
    isHost = !!data.isHost;
    saveProfile();
    saveLobbySession();

    document.getElementById("roomCodeDisplay").textContent = currentRoom;
    document.getElementById("hostControls").classList.toggle("hidden", !isHost);
    document.getElementById("hostSettings").classList.toggle("hidden", !isHost);
    updateMyPlayerTag();
    showScreen("lobbyScreen");
});

socket.on("kickedFromRoom", data => {
    clearLobbySession();
    currentRoom = "";
    isHost = false;
    showScreen("loginScreen");
    showToast(data?.message || "⛔ تم طردك من اللوبي.", "error");
});

socket.on("reconnectFailed", message => {
    clearLobbySession();
    currentRoom = "";
    isHost = false;
    showScreen("loginScreen");
    showError(message || "تعذر استعادة الغرفة.");
});

socket.on("lobbyUpdated", data => {
    const list = document.getElementById("lobbyPlayers");
    list.innerHTML = "";

    const countEl = document.getElementById("lobbyPlayerCount");
    if (countEl) countEl.textContent = data.playerCount ?? (data.players || []).length;

    isHost = data.hostId === socket.id;
    document.getElementById("hostControls").classList.toggle("hidden", !isHost);
    document.getElementById("hostSettings").classList.toggle("hidden", !isHost);

    data.players.forEach(player => {
        const div = document.createElement("div");
        div.className = "player lobby-player-name-only";

        const row = document.createElement("div");
        row.className = "lobby-player-row";

        const real = document.createElement("strong");
        real.className = "lobby-player-real-name";
        real.textContent = player.realName || "لا يوجد اسم";
        row.appendChild(real);

        if (player.isHost) {
            const leader = document.createElement("span");
            leader.className = "lobby-leader-badge";
            leader.textContent = "👑 القائد";
            row.appendChild(leader);
        }

        const level = document.createElement("span");
        level.className = "lobby-level-badge";
        level.textContent = `⭐ مستوى ${Number(player.level || 1)}`;
        row.appendChild(level);

        if (isHost && player.id !== socket.id) {
            const kick = document.createElement("button");
            kick.type = "button";
            kick.className = "lobby-kick-btn";
            kick.textContent = "⛔ طرد";
            kick.title = `طرد ${player.realName || player.nickName || "اللاعب"} من اللوبي`;
            kick.onclick = () => {
                if (confirm(`هل تريد طرد ${player.realName || player.nickName || "هذا اللاعب"} من اللوبي؟`)) {
                    socket.emit("kickPlayer", { roomCode: currentRoom, targetPlayerId: player.id });
                }
            };
            row.appendChild(kick);
        }

        div.appendChild(row);
        list.appendChild(div);
    });
});

socket.on("lobbyProfileUpdated", data => {
    myNickName = data?.nickName || myNickName;
    currentAvatarData = data?.avatar || currentAvatarData;
    const mainNick = document.getElementById("nickName");
    if (mainNick) mainNick.value = myNickName;
    saveProfile();
    saveLobbySession();
    updateMyPlayerTag();
    closeLobbyProfileEditor();
    showToast("✅ تم تحديث الاسم المستعار والصورة.", "success", 2400);
});

function leaveToHome() {
    const real = document.getElementById("realName");
    if (real) real.disabled = false;
    clearLobbySession();
    currentRoom = "";
    isHost = false;
    showScreen("loginScreen");
}

function leaveLobbyToHome() {
    const real = document.getElementById("realName");
    if (real) real.disabled = false;
    if (!currentRoom) {
        showScreen("loginScreen");
        return;
    }

    socket.emit("leaveRoom", {
        roomCode: currentRoom,
        playerKey
    });

    clearLobbySession();
    currentRoom = "";
    isHost = false;
    showScreen("loginScreen");
}

function startGame() {
    const chatDuration = document.getElementById("chatDurationSelect").value;
    const voteDuration = document.getElementById("voteDurationSelect").value;

    socket.emit("startGame", {
        roomCode: currentRoom,
        chatDuration,
        voteDuration
    });
}

function renderChatMembers(members) {
    const list = document.getElementById("chatMembersList");
    const count = document.getElementById("chatMemberCount");
    if (!list) return;

    chatMembers = (members || []).map(p => ({
        id: p.id || "",
        nickName: p.nickName || p.nick || "",
        avatar: p.avatar || ""
    })).filter(p => p.nickName);

    if (count) count.textContent = chatMembers.length;
    list.innerHTML = "";

    chatMembers.forEach(player => {
        const item = document.createElement("div");
        item.className = "chat-member";
        item.title = `منشن @${player.nickName}`;
        item.appendChild(getAvatarElement(player.avatar));

        const name = document.createElement("span");
        name.className = "chat-member-name";
        name.textContent = player.nickName;
        item.appendChild(name);

        item.addEventListener("click", () => mentionNickname(player.nickName));
        list.appendChild(item);
    });
}

function mentionNickname(nickName) {
    const input = document.getElementById("messageInput");
    if (!input || !nickName) return;

    const token = `@${nickName}`;
    const current = input.value || "";
    const separator = current && !/[\s]$/.test(current) ? " " : "";
    const next = current + separator + token + " ";

    input.value = next;
    input.focus();
    input.setSelectionRange(next.length, next.length);
}

function renderMessageText(message, members = chatMembers) {
    const fragment = document.createDocumentFragment();
    const text = String(message ?? "");
    const names = [...new Set((members || []).map(p => p.nickName).filter(Boolean))]
        .sort((a, b) => b.length - a.length);

    if (!names.length) {
        fragment.appendChild(document.createTextNode(text));
        return fragment;
    }

    const escapedNames = names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const regex = new RegExp(`@(${escapedNames.join("|")})(?!\\S)`, "g");
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }

        const span = document.createElement("span");
        span.className = "mention";
        span.textContent = match[0];
        fragment.appendChild(span);
        lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    return fragment;
}

socket.on("phaseChanged", data => {
    if (isSpectator) {
        showScreen("spectatorScreen");
        return;
    }

    showScreen("gameScreen");

    if (data.phase === "CHAT") {
        // كل جولة تبدأ بمحادثة جديدة حتى لا تتكرر رسائل الجولة السابقة.
        const chatBox = document.getElementById("chatBox");
        const spectatorChat = document.getElementById("spectatorChat");
        const deadChat = document.getElementById("deadChat");
        if (chatBox) chatBox.innerHTML = "";
        if (spectatorChat) spectatorChat.innerHTML = "";
        if (deadChat) deadChat.innerHTML = "";
        const messageInput = document.getElementById("messageInput");
        if (messageInput) messageInput.value = "";
        document.getElementById("phaseTitle").textContent = "🗣️ مرحلة المحادثة والنقاش";
        document.getElementById("chatSection").classList.remove("hidden");
        document.getElementById("voteSection").classList.add("hidden");
        document.getElementById("finalSection").classList.add("hidden");
        renderChatMembers(data.chatMembers || []);
    }

    if (data.phase === "VOTE") {
        document.getElementById("phaseTitle").textContent = "🗳️ مرحلة التصويت والتخمين";
        document.getElementById("chatSection").classList.add("hidden");
        document.getElementById("voteSection").classList.remove("hidden");
        document.getElementById("finalSection").classList.add("hidden");

        submittedVote = false;
        document.getElementById("voteStatus").textContent = "";

        buildVoteForm(
            data.players || data.aliveNickNames.map((nick, i) => ({ nickName: nick, realName: data.realNames?.[i] || "", avatar: data.avatars?.[i] || "" })),
            data.identityOptions || (data.realNames || []).map(real => ({ realName: real }))
        );
    }
});

socket.on("chatMembersUpdated", data => {
    renderChatMembers(data?.members || []);
});

socket.on("newMessage", data => {
    addMessage(
        document.getElementById("chatBox"),
        data.nickName,
        data.message,
        data.avatar,
        data.playerId === socket.id,
        true
    );

    const realNameDisplay = data.realName ? ` (${data.realName})` : "";

    addMessage(
        document.getElementById("spectatorChat"),
        data.nickName + realNameDisplay,
        data.message,
        data.avatar,
        false
    );
});

socket.on("spectatorMessage", data => {
    const nameStr = data.realName
        ? `${data.nickName} (${data.realName})`
        : data.nickName;

    addMessage(
        document.getElementById("deadChat"),
        nameStr,
        data.message,
        data.avatar,
        data.playerId === socket.id
    );
});

function addMessage(box, nick, message, avatarData, isMe = false, enableMentions = false) {
    if (!box) return;

    const div = document.createElement("div");
    div.className = "message";

    div.appendChild(getAvatarElement(avatarData));

    const content = document.createElement("div");
    content.className = "message-content";

    const strong = document.createElement("strong");
    strong.textContent = isMe ? "أنت: " : `${nick}: `;

    content.appendChild(strong);
    if (enableMentions) {
        content.appendChild(renderMessageText(message, chatMembers));
    } else {
        content.appendChild(document.createTextNode(message));
    }

    div.appendChild(content);

    if (enableMentions && nick) {
        div.title = `اضغط لمنشن @${nick}`;
        div.addEventListener("click", () => mentionNickname(nick));
    }

    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
}


function sendMessage() {
    const input = document.getElementById("messageInput");
    const message = input.value.trim();

    if (!message) return;

    socket.emit("sendMessage", {
        roomCode: currentRoom,
        message
    });

    input.value = "";
}

function sendSpectatorMessage() {
    const input = document.getElementById("spectatorMessage");
    const message = input.value.trim();

    if (!message) return;

    socket.emit("sendSpectatorMessage", {
        roomCode: currentRoom,
        message
    });

    input.value = "";
}

function chatEnter(event) {
    if (event.key === "Enter") sendMessage();
}

function spectatorEnter(event) {
    if (event.key === "Enter") sendSpectatorMessage();
}

function buildVoteForm(players, identityOptions = []) {
    const form = document.getElementById("voteForm");
    form.innerHTML = "";

    const normalizedPlayers = (players || []).map(p => ({
        nickName: p.nickName || p.nick || "",
        realName: p.realName || "",
        avatar: p.avatar || ""
    }));

    const availableReals = (identityOptions || [])
        .map(p => typeof p === "string" ? p : p.realName)
        .filter(Boolean)
        .filter((real, i, arr) => real !== myRealName && arr.indexOf(real) === i);

    normalizedPlayers
        .filter(player => player.nickName && player.nickName !== myNickName)
        .forEach(player => {
            const item = document.createElement("div");
            item.className = "vote-item";

            const identity = document.createElement("div");
            identity.className = "vote-player-identity";
            identity.appendChild(getAvatarElement(player.avatar));

            const title = document.createElement("strong");
            title.textContent = player.nickName;
            identity.appendChild(title);

            const select = document.createElement("select");
            select.className = "guess-select";
            select.dataset.nick = player.nickName;

            select.appendChild(new Option("اختر الاسم الحقيقي", ""));

            availableReals.forEach(real => {
                select.appendChild(new Option(real, real));
            });

            select.addEventListener("change", updateDuplicateOptions);

            item.appendChild(identity);
            item.appendChild(select);
            form.appendChild(item);
        });
}

function updateDuplicateOptions() {
    const selects = document.querySelectorAll(".guess-select");
    const used = new Set();

    selects.forEach(select => {
        if (select.value) used.add(select.value);
    });

    selects.forEach(select => {
        const current = select.value;

        Array.from(select.options).forEach(option => {
            if (!option.value) return;

            option.disabled =
                used.has(option.value) &&
                option.value !== current;
        });
    });
}

function submitVotes() {
    if (submittedVote) return;

    const selects = document.querySelectorAll(".guess-select");
    const guesses = {};
    const used = new Set();

    for (const select of selects) {
        if (!select.value) {
            return showError("يجب اختيار اسم حقيقي لكل لاعب قبل التأكيد.");
        }

        if (used.has(select.value)) {
            return showError("لا يمكنك اختيار نفس الاسم الحقيقي مرتين.");
        }

        used.add(select.value);
        guesses[select.dataset.nick] = select.value;
    }

    socket.emit("submitVotes", {
        roomCode: currentRoom,
        guesses
    });
}

socket.on("voteSubmitted", () => {
    submittedVote = true;
    document.getElementById("voteStatus").textContent =
        "🔒 تم تثبيت تخميناتك بنجاح.";
});

socket.on("eliminationPending", data => {
    showScreen("roundResultScreen");

    document.getElementById("eliminationHeadline").textContent =
        "🎭 لحظة الحسم...";

    document.getElementById("suspenseBox").classList.remove("hidden");
    document.getElementById("revealedBox").classList.add("hidden");

    let timeLeft = data.seconds || 5;
    const timerElem = document.getElementById("suspenseTimer");
    timerElem.textContent = timeLeft;

    if (suspenseCountdownInterval) {
        clearInterval(suspenseCountdownInterval);
    }

    suspenseCountdownInterval = setInterval(() => {
        timeLeft--;
        timerElem.textContent = Math.max(timeLeft, 0);

        if (timeLeft <= 0) {
            clearInterval(suspenseCountdownInterval);
        }
    }, 1000);
});

socket.on("roundResult", data => {
    showScreen("roundResultScreen");

    if (suspenseCountdownInterval) {
        clearInterval(suspenseCountdownInterval);
    }

    document.getElementById("eliminationHeadline").textContent =
        "🔴 نهاية الجولة";

    document.getElementById("suspenseBox").classList.add("hidden");
    document.getElementById("revealedBox").classList.remove("hidden");

    document.getElementById("eliminatedName").textContent =
        data.eliminatedNick || "لا أحد";

    let timeLeft = data.nextPhaseIn || 10;
    const timerElem = document.getElementById("eliminationTimer");
    timerElem.textContent = timeLeft;

    if (resultCountdownInterval) {
        clearInterval(resultCountdownInterval);
    }

    resultCountdownInterval = setInterval(() => {
        timeLeft--;
        timerElem.textContent = Math.max(timeLeft, 0);

        if (timeLeft <= 0) {
            clearInterval(resultCountdownInterval);
        }
    }, 1000);
});

socket.on("spectatorMode", data => {
    isSpectator = true;

    document.getElementById("myIdentity").textContent =
        `${data.nickName} (${data.realName})`;

    showScreen("spectatorScreen");
});

socket.on("timerUpdate", seconds => {
    AudioManager.onTimer(seconds);
    const safeSeconds = Math.max(Number(seconds) || 0, 0);
    const minutes = Math.floor(safeSeconds / 60);
    const secs = safeSeconds % 60;

    document.getElementById("timer").textContent =
        `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
});

socket.on("finalGuessStarted", data => {
    if (isSpectator) {
        showScreen("spectatorScreen");
        return;
    }

    showScreen("gameScreen");

    document.getElementById("chatSection").classList.add("hidden");
    document.getElementById("voteSection").classList.add("hidden");
    document.getElementById("finalSection").classList.remove("hidden");
    document.getElementById("phaseTitle").textContent =
        "🎯 التوقع الأخير الحاسم";

    const opponent = data.players.find(p => p !== myNickName);

    document.getElementById("finalOpponent").innerHTML =
        `<div class="notice">🎯 توقع هوية منافسك الأخير: <strong>${escapeHtml(opponent || "")}</strong></div>`;

    const select = document.getElementById("finalSelect");
    select.innerHTML = `<option value="">اختر الاسم الحقيقي...</option>`;

    const identityOptions = (data.identityOptions || data.realNames || []).map(item =>
        typeof item === "string" ? item : item.realName
    );
    const availableReals = identityOptions
        .filter(Boolean)
        .filter((real, i, arr) => real !== myRealName && arr.indexOf(real) === i);

    availableReals.forEach(real => {
        select.appendChild(new Option(real, real));
    });

    document.getElementById("finalStatus").textContent = "";
});

function submitFinalGuess() {
    const value = document.getElementById("finalSelect").value;

    if (!value) {
        return showError("الرجاء اختيار اسم حقيقي من القائمة.");
    }

    socket.emit("submitFinalGuess", {
        roomCode: currentRoom,
        guessedRealName: value
    });
}

let finalSuspenseInterval = null;

function startFinalSuspense() {
    showScreen("finalResultScreen");

    const suspenseBox = document.getElementById("finalSuspenseBox");
    const revealBox = document.getElementById("finalRevealBox");
    const headline = document.getElementById("finalResultHeadline");
    const timer = document.getElementById("finalSuspenseTimer");

    suspenseBox.classList.remove("hidden");
    revealBox.classList.add("hidden");
    headline.textContent = "لحظة الحسم...";
    timer.textContent = "4";

    if (finalSuspenseInterval) {
        clearInterval(finalSuspenseInterval);
    }

    let left = 4;
    finalSuspenseInterval = setInterval(() => {
        left--;
        timer.textContent = left;

        if (left <= 0) {
            clearInterval(finalSuspenseInterval);
            finalSuspenseInterval = null;
        }
    }, 1000);
}

socket.on("finalGuessSubmitted", () => {
    document.getElementById("finalStatus").textContent =
        "🔒 تم إرسال توقعك. بانتظار الخصم...";
});

socket.on("finalGuessSuspense", () => {
    startFinalSuspense();
});

socket.on("finalGuessReveal", data => {
    if (finalSuspenseInterval) {
        clearInterval(finalSuspenseInterval);
        finalSuspenseInterval = null;
    }

    document.getElementById("finalSuspenseBox").classList.add("hidden");
    document.getElementById("finalRevealBox").classList.remove("hidden");

    const headline = document.getElementById("finalResultHeadline");
    const title = document.getElementById("finalRevealTitle");
    const playersBox = document.getElementById("finalRevealPlayers");
    const retryNotice = document.getElementById("finalRetryNotice");

    playersBox.innerHTML = "";
    retryNotice.classList.add("hidden");

    if (data.type === "BOTH_CORRECT") {
        headline.textContent = "🔥 كلاهما أصاب التوقع!";
        title.textContent = "🎯 كلا اللاعبين جابوا الهوية صح — النقاط تحدد الفائز في النهاية.";
    } else if (data.type === "ONE_CORRECT") {
        headline.textContent = "⚡ التوقع الصحيح!";
        title.textContent =
            `✅ ${escapeHtml((data.correctPlayers || [])[0] || "لاعب")} جابها صح — الفائز يحدد حسب أعلى نقاط في لوحة النتائج.`;
    } else {
        headline.textContent = "💥 كلاهما أخطأ!";
        title.textContent = "❌ لا أحد أصاب هوية منافسه.";
        retryNotice.textContent = "سيتم إعادة التوقع النهائي بعد لحظات...";
        retryNotice.classList.remove("hidden");
    }

    (data.players || []).forEach(player => {
        const row = document.createElement("div");
        row.className =
            "final-reveal-player " + (player.correct ? "correct" : "wrong");

        const name = document.createElement("div");
        name.className = "final-reveal-name";
        name.textContent = player.nickName;

        const status = document.createElement("div");
        status.className = "final-reveal-status";
        status.textContent = player.correct ? "✅ صحيح" : "❌ خطأ";

        row.appendChild(name);
        row.appendChild(status);
        playersBox.appendChild(row);
    });
});

socket.on("finalGuessRetry", data => {
    AudioManager.play("retry");
    document.getElementById("finalSelect").value = "";
    document.getElementById("finalStatus").textContent =
        data?.message || "🔄 كلا التوقعين خطأ. حاولوا مرة أخرى!";

    // يعاد عرض واجهة الاختيار من السيرفر.
    showScreen("gameScreen");
    document.getElementById("chatSection").classList.add("hidden");
    document.getElementById("voteSection").classList.add("hidden");
    document.getElementById("finalSection").classList.remove("hidden");
    document.getElementById("phaseTitle").textContent =
        "🎯 التوقع الأخير الحاسم";

    // حتى لا تبقى رسالة قديمة من المحاولة السابقة.
    setTimeout(() => {
        document.getElementById("finalStatus").textContent = "";
    }, 3000);
});

socket.on("returnToLobby", data => {
    isSpectator = false;
    submittedVote = false;
    document.getElementById("finalSelect").value = "";
    document.getElementById("voteForm").innerHTML = "";
    document.getElementById("chatBox").innerHTML = "";
    document.getElementById("spectatorChat").innerHTML = "";
    document.getElementById("deadChat").innerHTML = "";
    document.getElementById("phaseTitle").textContent = "🗣️ مرحلة المحادثة";
    if (data?.players) {
        const me = data.players.find(p => p.playerKey === playerKey);
        if (me) {
            myRealName = me.realName || myRealName;
            myNickName = me.nickName || myNickName;
            currentAvatarData = me.avatar || currentAvatarData;
            saveProfile();
            saveLobbySession();
        }
    }
    document.getElementById("roomCodeDisplay").textContent = currentRoom;
    showScreen("lobbyScreen");
    showToast("🏠 رجعتم للّوبي. تقدرون تبدؤون مباراة جديدة.", "success", 3000);
});

socket.on("gameOver", data => {
    showScreen("resultScreen");

    const result = data.result || {};
    const winnerBannerText = document.getElementById("winnerText");

    const rankings = data.rankings || [];
    const topScore = rankings.length ? Number(rankings[0].score || 0) : 0;
    const topPlayers = rankings.filter(item => Number(item.score || 0) === topScore);
    winnerBannerText.textContent = topPlayers.length
        ? "🏆 " + topPlayers.map(item => item.nickName || item.realName).join(" و ") + ` — ${topScore} نقطة`
        : "🏆 انتهت المعركة";

    const rankingsList = document.getElementById("rankingsList");
    rankingsList.innerHTML = "";

    rankings.forEach(item => {
        const div = document.createElement("div");
        div.className = "rank-item";

        const infoDiv = document.createElement("div");
        infoDiv.className = "rank-info";

        const badge = document.createElement("div");
        badge.className = `rank-badge rank-${item.rank}`;
        badge.textContent = `#${item.rank}`;

        infoDiv.appendChild(badge);
        infoDiv.appendChild(getAvatarElement(item.avatar));

        const namesText = document.createElement("div");

        const realStrong = document.createElement("strong");
        realStrong.style.fontSize = "16px";
        realStrong.textContent = item.realName;

        const nickSpan = document.createElement("span");
        nickSpan.style.color = "#9ca3af";
        nickSpan.style.fontSize = "13px";
        nickSpan.textContent = ` (${item.nickName})`;

        namesText.appendChild(realStrong);
        namesText.appendChild(nickSpan);
        infoDiv.appendChild(namesText);

        const scoreSpan = document.createElement("div");
        scoreSpan.style.fontWeight = "bold";
        scoreSpan.style.color = "var(--text-highlight)";
        scoreSpan.textContent = `${item.score} نقطة`;

        div.appendChild(infoDiv);
        div.appendChild(scoreSpan);
        rankingsList.appendChild(div);
    });
});


socket.on("audioEvent", event => {
    if (event && event.name) AudioManager.play(event.name);
});

socket.on("errorMsg", message => showError(message));

function showToast(message, type = "info", duration = 3600) {
    const container = document.getElementById("toastContainer");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.setAttribute("role", "status");
    toast.textContent = String(message ?? "");
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("show"));
    setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => toast.remove(), 250);
    }, Math.max(1200, duration));
}

function showError(message) {
    showToast(message, "error");
    const error = document.getElementById("loginError");
    error.textContent = message;

    const voteError = document.getElementById("voteStatus");

    if (
        voteError &&
        !message.includes("موجودة") &&
        !message.includes("مستخدم")
    ) {
        voteError.textContent = message;
        voteError.style.color = "#f87171";
    }

    setTimeout(() => {
        error.textContent = "";

        if (voteError) {
            voteError.textContent = "";
        }
    }, 5000);
}

function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value ?? "";
    return div.innerHTML;
}
