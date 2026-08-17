const socket = io();

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
    const s = document.getElementById("sfxVolume"), a = document.getElementById("ambienceVolume");
    if (s) s.value = AudioManager.getSfx();
    if (a) a.value = AudioManager.getAmbience();
    const muted = AudioManager.isMuted();
    const m = document.getElementById("muteSoundBtn"), t = document.getElementById("soundToggle");
    if (m) m.textContent = muted ? "🔊 تشغيل الصوت" : "🔇 كتم الصوت";
    if (t) t.textContent = muted ? "🔇 الصوت" : "🔊 الصوت";
});


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

function selectAvatar(element, data) {
    document.querySelectorAll(".avatar-circle").forEach(el => el.classList.remove("selected"));
    element.classList.add("selected");
    currentAvatarData = data;
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

    modal.classList.remove("hidden");

    const input = document.getElementById("pinterestImageUrl");
    const error = document.getElementById("pinterestError");
    if (error) error.textContent = "";

    if (input) {
        input.focus();
        input.addEventListener("input", previewPinterestImage, { once: false });
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

function previewPinterestImage() {
    const input = document.getElementById("pinterestImageUrl");
    const preview = document.getElementById("pinterestPreview");
    const image = document.getElementById("pinterestPreviewImage");
    const error = document.getElementById("pinterestError");

    if (!input || !preview || !image) return;

    const url = input.value.trim();
    if (!url) {
        preview.classList.add("hidden");
        if (error) error.textContent = "";
        return;
    }

    if (!/^https?:\/\/\S+$/i.test(url)) {
        preview.classList.add("hidden");
        if (error) error.textContent = "ألصق رابط صورة صحيح يبدأ بـ https://";
        return;
    }

    image.onload = () => {
        preview.classList.remove("hidden");
        if (error) error.textContent = "";
    };

    image.onerror = () => {
        preview.classList.add("hidden");
        if (error) {
            error.textContent =
                "هذا الرابط ليس رابط صورة مباشر. من Pinterest استخدم «نسخ عنوان الصورة» ثم الصقه هنا.";
        }
    };

    image.src = url;
}

function usePinterestImage() {
    const input = document.getElementById("pinterestImageUrl");
    const image = document.getElementById("pinterestPreviewImage");
    const error = document.getElementById("pinterestError");

    const url = input ? input.value.trim() : "";

    if (!url || !/^https?:\/\/\S+$/i.test(url)) {
        if (error) error.textContent = "ألصق رابط الصورة أولاً.";
        return;
    }

    if (!image || !image.complete || !image.naturalWidth) {
        if (error) {
            error.textContent =
                "تعذر تحميل الصورة. تأكد أنك نسخت «عنوان الصورة» وليس رابط صفحة الـPin.";
        }
        return;
    }

    /*
     * نخزن رابط الصورة مباشرة كأفاتار.
     * بهذه الطريقة لا نحتاج تنزيل الصورة على السيرفر،
     * ولا نحتاج صلاحيات Pinterest أو API key.
     */
    currentAvatarData = url;

    document.querySelectorAll(".avatar-circle").forEach(el =>
        el.classList.remove("selected")
    );

    const customDiv = document.createElement("div");
    customDiv.className = "avatar-circle selected pinterest-selected-avatar";
    customDiv.style.backgroundImage = `url("${url.replace(/"/g, '\\"')}")`;
    customDiv.onclick = function() {
        selectAvatar(this, currentAvatarData);
    };

    const section = document.querySelector(".avatar-section");
    const label = document.querySelector(".custom-avatar-label");

    if (section && label) {
        const previous = section.querySelector(".pinterest-selected-avatar");
        if (previous) previous.remove();
        section.insertBefore(customDiv, label);
    }

    closePinterestPicker();
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

function createRoom() {
    const realName = document.getElementById("realName").value.trim();
    const nickName = document.getElementById("nickName").value.trim();

    if (!realName || !nickName) {
        return showError("أدخل اسمك الحقيقي والمستعار.");
    }

    myNickName = nickName;
    myRealName = realName;

    socket.emit("createRoom", {
        realName,
        nickName,
        avatar: currentAvatarData
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

    socket.emit("joinRoom", {
        roomCode,
        realName,
        nickName,
        avatar: currentAvatarData
    });
}

socket.on("roomCreated", data => {
    currentRoom = data.roomCode;
    isHost = true;

    document.getElementById("roomCodeDisplay").textContent = currentRoom;
    document.getElementById("hostControls").classList.remove("hidden");
    document.getElementById("hostSettings").classList.remove("hidden");

    updateMyPlayerTag();
    showScreen("lobbyScreen");
});

socket.on("joinedSuccess", data => {
    currentRoom = data.roomCode;

    document.getElementById("roomCodeDisplay").textContent = currentRoom;
    updateMyPlayerTag();
    showScreen("lobbyScreen");
});

socket.on("lobbyUpdated", data => {
    const list = document.getElementById("lobbyPlayers");
    list.innerHTML = "";

    data.players.forEach(player => {
        const div = document.createElement("div");
        div.className = "player";

        div.appendChild(getAvatarElement(player.avatar));

        const text = document.createElement("span");
        text.textContent = player.nickName;
        text.style.fontWeight = "bold";

        div.appendChild(text);
        list.appendChild(div);
    });
});

function startGame() {
    const chatDuration = document.getElementById("chatDurationSelect").value;
    const voteDuration = document.getElementById("voteDurationSelect").value;

    socket.emit("startGame", {
        roomCode: currentRoom,
        chatDuration,
        voteDuration
    });
}

socket.on("phaseChanged", data => {
    if (isSpectator) {
        showScreen("spectatorScreen");
        return;
    }

    showScreen("gameScreen");

    if (data.phase === "CHAT") {
        document.getElementById("phaseTitle").textContent = "🗣️ مرحلة المحادثة والنقاش";
        document.getElementById("chatSection").classList.remove("hidden");
        document.getElementById("voteSection").classList.add("hidden");
        document.getElementById("finalSection").classList.add("hidden");
    }

    if (data.phase === "VOTE") {
        document.getElementById("phaseTitle").textContent = "🗳️ مرحلة التصويت والتخمين";
        document.getElementById("chatSection").classList.add("hidden");
        document.getElementById("voteSection").classList.remove("hidden");
        document.getElementById("finalSection").classList.add("hidden");

        submittedVote = false;
        document.getElementById("voteStatus").textContent = "";

        buildVoteForm(data.aliveNickNames, data.realNames);
    }
});

socket.on("newMessage", data => {
    addMessage(
        document.getElementById("chatBox"),
        data.nickName,
        data.message,
        data.avatar,
        data.playerId === socket.id
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

function addMessage(box, nick, message, avatarData, isMe = false) {
    if (!box) return;

    const div = document.createElement("div");
    div.className = "message";

    div.appendChild(getAvatarElement(avatarData));

    const content = document.createElement("div");
    content.className = "message-content";

    const strong = document.createElement("strong");
    strong.textContent = isMe ? "أنت: " : `${nick}: `;

    content.appendChild(strong);
    content.appendChild(document.createTextNode(message));

    div.appendChild(content);
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

function buildVoteForm(nicks, reals) {
    const form = document.getElementById("voteForm");
    form.innerHTML = "";

    const availableReals = reals.filter(r => r !== myRealName);
    const otherNicks = nicks.filter(n => n !== myNickName);

    otherNicks.forEach(nick => {
        const item = document.createElement("div");
        item.className = "vote-item";

        const title = document.createElement("strong");
        title.textContent = "👤 " + nick;
        title.style.minWidth = "120px";

        const select = document.createElement("select");
        select.className = "guess-select";
        select.dataset.nick = nick;

        select.appendChild(new Option("اختر الاسم الحقيقي", ""));

        availableReals.forEach(real => {
            select.appendChild(new Option(real, real));
        });

        select.addEventListener("change", updateDuplicateOptions);

        item.appendChild(title);
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

    const availableReals = data.realNames.filter(r => r !== myRealName);

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
        headline.textContent = "🔥 كلاهما صحيح!";
        title.textContent = "🎉 كلا اللاعبين أصابا التوقع!";
    } else if (data.type === "ONE_CORRECT") {
        headline.textContent = "⚡ واحد فقط كان صحيحاً!";
        title.textContent =
            `🏆 التوقع الصحيح: ${escapeHtml((data.correctPlayers || [])[0] || "")}`;
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

socket.on("gameOver", data => {
    showScreen("resultScreen");

    const result = data.result || {};
    const winnerBannerText = document.getElementById("winnerText");

    if (result.type === "BOTH_WIN" || result.type === "PLAYER_WIN") {
        winnerBannerText.textContent =
            "🏆 " + (result.winners || []).join(" & ");
    } else {
        winnerBannerText.textContent =
            "🏆 انتهت المعركة بنجاح!";
    }

    const rankingsList = document.getElementById("rankingsList");
    rankingsList.innerHTML = "";

    data.rankings.forEach(item => {
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

function showError(message) {
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
