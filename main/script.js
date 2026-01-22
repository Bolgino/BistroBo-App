// CONFIG FIREBASE
const firebaseConfig = {
    apiKey: "AIzaSyDxpd24nF3qmNrh8j40jxjhYzh1RC08DhI",
    authDomain: "comande-6fb85.firebaseapp.com",
    databaseURL: "https://comande-6fb85-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "comande-6fb85",
    storageBucket: "comande-6fb85.firebasestorage.app",
    messagingSenderId: "676960522709",
    appId: "1:676960522709:web:cc2284c87e73044f566d5c"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();

window.selectedMap = window.selectedMap || {};
window.tickState = window.tickState || {}; 

// Variabili globali
let ruolo = null;
let uid = null;
let comandaCorrente = [];
window.ingredientData = {};
const loginDiv = document.getElementById("loginDiv");
const registerDiv = document.getElementById("registerDiv");
const comandeNotificate = new Set(JSON.parse(localStorage.getItem("comandeNotificate") || "[]"));
let logoutVolontario = false;      
let statusListenerRef = null;     
let timestampServerUTC = null; 
let avvioLocale = null;
let menuData = {};

// --- GLOBAL SETTINGS (unica fonte di verità per i toggle) ---
window.settings = {
  suono: true,
  approvazioneAutomatica: false,
  nuoveInAltoCucina: true,
  nuoveInAltoBere: true,
  suonoCassa: true,
  suonoChat: true, 
  stampaAutomaticaComande: false,
  letteraPreordini: "D",
  suonoPreordini: true,
  ordinaPreordini: true,
  nuoveInAltoSnack: false,
  preordiniRichiediInfo: false,
  nomeStand: "BistroBò"
};

//Ingredienti Critici
let ingredientiCriticiPrecedenti = new Map();
const sogliePerUnita = {
    "pz": { attenzione: 15, critica: 5 },
    "kg": { attenzione: 2, critica: 0.5 },
    "l":  { attenzione: 5, critica: 1 }
};

// Variabile globale per tracciare l’ultimo stato online
let lastOnlineCheck = { online: true, timestamp: Date.now() };

// Loader offline dedicato
const offlineLoader = document.getElementById("offlineLoader");

// Funzione checkOnline aggiornata
function checkOnline(silenzioso = false, sogliaMs = 2000) {
    const online = navigator.onLine;
    const now = Date.now();

    if (online) {
        // Aggiorna timestamp ma **non nascondere il loader**
        lastOnlineCheck.online = true;
        lastOnlineCheck.timestamp = now;
        return true;
    } else {
        if (lastOnlineCheck.online) {
            // Prima volta offline → salva timestamp
            lastOnlineCheck.online = false;
            lastOnlineCheck.timestamp = now;
            return true; // considerato ancora online fino a soglia
        } else {
            const diff = now - lastOnlineCheck.timestamp;
            if (diff >= sogliaMs) {
                // Mostra loader offline e blocca UI
                if (offlineLoader) offlineLoader.style.display = "flex";
                document.body.style.pointerEvents = "none";
                document.body.style.userSelect = "none";

                // Polling continuo per ricaricare appena torna online
                const interval = setInterval(() => {
                    if (navigator.onLine) {
                        clearInterval(interval);
                        location.reload(); // ricarica pagina quando ritorna rete
                    }
                }, 1000);

                return false; // consideriamo offline
            } else {
                return true; // ancora sotto soglia
            }
        }
    }
}
// Polling automatico ogni secondo
setInterval(() => {
    checkOnline();
}, 1000);
//LOADING
function showLoader() {
  const loader = document.getElementById("loader");
  if (loader) loader.classList.remove("hidden");
}
function hideLoader() {
  const loader = document.getElementById("loader");
  if (loader) loader.classList.add("hidden");
}
// ----------- IMPOSTAZIONI ----------------
// Funzione toggle sicuro, dinamico e multi-uso
function initToggle(btn, ref, labels = {on: "ON", off: "OFF"}, fallback = false, callback = null) {
    if (!btn) return;
    if (!checkOnline(true)) return;
    // Listener realtime → aggiorna UI e invoca callback
    ref.on("value", snap => {
        const val = snap.exists() ? snap.val() === true : fallback;
        btn.innerText = val ? labels.on : labels.off;
        btn.dataset.value = val;
        if (typeof callback === "function") callback(val);
    }, err => {
        console.warn("initToggle read error:", err);
        // fallback UI + callback
        btn.innerText = fallback ? labels.on : labels.off;
        btn.dataset.value = fallback;
        if (typeof callback === "function") callback(fallback);
    });

    // Click → scrive sul DB con transaction (safe)
    btn.onclick = async () => {
        btn.disabled = true;
        try {
            await ref.transaction(current => {
                if (current === null) return !fallback;
                return !(current === true);
            });
        } catch (e) {
            console.error("initToggle write error:", e);
        } finally {
            setTimeout(() => { btn.disabled = false; }, 300);
        }
    };
}
document.addEventListener("DOMContentLoaded", () => {
    // Inizializza i toggle impostazioni
    initImpostazioniToggle();

    // Listener per snackAbilitato → lo metti SOLO dopo il login
    auth.onAuthStateChanged(user => {
        if (user) {
            // Utente loggato → metti listener
            db.ref("impostazioni/snackAbilitato").on("value", snap => {
                window.settings.snackAbilitato = !!snap.val();
                caricaComandeCassa(); // ricarica la lista per applicare i cambiamenti
            });
        }
    });
});
function abilitaIncrementoDinamico(input) {
    input.addEventListener("wheel", e => e.preventDefault()); // evita scroll

    // 🔹 Aggiorna step dinamico in base ai decimali presenti
    function aggiornaStep() {
        let val = input.value.replace(",", ".");
        if (!val || isNaN(val)) {
            input.step = "any";
            return;
        }

        const parteDecimale = val.split(".")[1];
        if (parteDecimale && parteDecimale.length > 0) {
            // esempio: 0.001 → step 0.001
            const step = 1 / Math.pow(10, parteDecimale.length);
            input.step = step;
        } else {
            input.step = 1; // nessun decimale → incremento di 1
        }
    }

    // 🔹 Rileva ogni modifica e aggiorna lo step
    input.addEventListener("input", aggiornaStep);
    input.addEventListener("focus", aggiornaStep);

    // 🔹 Rileva click sulle freccette e aggiorna lo step prima del cambio
    input.addEventListener("keydown", e => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") aggiornaStep();
    });

    aggiornaStep(); // inizializza subito
}
// -------------------- REGISTRAZIONE UTENTE --------------------
document.getElementById("vaiRegBtn").onclick = async () => {
    loginDiv.classList.add("hidden");
    registerDiv.classList.remove("hidden");

    const regRoleSelect = document.getElementById("regRole");
    const labelRegRole = document.getElementById("labelRegRole");

    // Nascondi inizialmente
    regRoleSelect.style.display = "none";
    labelRegRole.style.display = "none";
    hideLoader();

    try {
        // Leggi valore approvazione automatica dal DB
        const snap = await db.ref("impostazioni/approvazioneAutomatica").once("value");
        const approvAuto = snap.exists() && snap.val() === true;

        // Mostra il select solo se approvAuto = true
        if (approvAuto) {
            regRoleSelect.style.display = "inline-block";
            labelRegRole.style.display = "inline-block";
            await popolaSelectRuoliConSnack(regRoleSelect);
        } else {
            regRoleSelect.style.display = "none";
            labelRegRole.style.display = "none";
            regRoleSelect.value = "";
        }

        console.log("DEBUG: apri registrazione, approvAuto =", approvAuto);

    } catch (err) {
        console.warn("Errore lettura approvazioneAutomatica:", err);
    }
};
document.getElementById("regBtn").onclick = async () => {
    showLoader();
    const email = document.getElementById("regEmail").value.trim();
    const password = document.getElementById("regPassword").value;
    const regMsgDiv = document.getElementById("regMsg");

    if (!email || !password) {
        regMsgDiv.innerText = "⚠️ Compila tutti i campi";
        return;
    }

    const regRoleSelect = document.getElementById("regRole");
    const labelRegRole = document.getElementById("labelRegRole");

    // Leggi approvazione automatica dal DB
    let approvAuto = false;
    try {
        const snapApprov = await db.ref("impostazioni/approvazioneAutomatica").once("value");
        approvAuto = snapApprov.exists() ? snapApprov.val() === true : false;
    } catch (e) {
        console.warn("Impossibile leggere approvazioneAutomatica, uso fallback:", e);
        approvAuto = false;
    }

    // Mostra select ruolo se approvazione automatica attiva
    if (approvAuto) {
        if (!regRoleSelect || !labelRegRole) {
            hideLoader();
            notify("⚠️ Errore: elemento select ruolo non trovato.", "warn");
            return;
        }
        regRoleSelect.style.display = "inline-block";
        labelRegRole.style.display = "inline-block";

        if (!regRoleSelect.value) {
            hideLoader();
            notify("⚠️ Seleziona un ruolo!", "warn");
            return;
        }
    } else {
        if (regRoleSelect && labelRegRole) {
            regRoleSelect.style.display = "none";
            labelRegRole.style.display = "none";
            regRoleSelect.value = "";
        }
    }

    try {
        // crea account Firebase
        const res = await auth.createUserWithEmailAndPassword(email, password);
        await res.user.sendEmailVerification();

        const ruoloUtente = approvAuto ? regRoleSelect.value : "utente";
        // Se snack è selezionato ma disattivato, correggi in "utente"
        if (ruoloUtente === "snack") {
            const snapSnack = await db.ref("impostazioni/snackAbilitato").once("value");
            if (!snapSnack.exists() || !snapSnack.val()) {
                notify("⚠️ Il profilo Snack non è attivo, seleziona un altro ruolo.", "warn");
                hideLoader();
                return;
            }
        }


        // salva utente su DB
        await db.ref("utenti/" + res.user.uid).set({
            username: email,
            ruolo: ruoloUtente,
            approvato: approvAuto,
            attivo: true
        });

        // notifiche
        const msg = approvAuto
            ? "✅ Registrazione completata! 📧 Controlla subito la tua email(anche le Spam) e conferma l'account."
            : "✅ Registrazione completata! 📧 Controlla subito la tua email(anche le Spam) e conferma l'account. 🛠️ Dopo verifica, contatta l’amministratore.";

        notify(msg, "info");
        regMsgDiv.innerHTML = msg;

        // pulizia campi
        document.getElementById("regEmail").value = "";
        document.getElementById("regPassword").value = "";
        if (regRoleSelect) regRoleSelect.value = "";
        
    } catch (err) {
        regMsgDiv.innerText = "❌ " + err.message;
    } finally {
        hideLoader();
    }
    
};

// -------------------- IMPOSTAZIONI TOGGLE SICURE --------------------
function initImpostazioniToggle() {
    // APPROVAZIONE AUTOMATICA
    if (!checkOnline(true)) return;
    const toggleApprovazioneBtn = document.getElementById("toggleApprovazioneBtn");
    const approvazioneRef = db.ref("impostazioni/approvazioneAutomatica");

    initToggle(toggleApprovazioneBtn, approvazioneRef, {on: "ON", off: "OFF"}, false, val => {
        const regRoleSelect = document.getElementById("regRole");
        const labelRegRole = document.getElementById("labelRegRole");

        if (!regRoleSelect || !labelRegRole) {
            console.warn("regRoleSelect / labelRegRole non trovati nel DOM, skip UI update");
            return;
        }

        if (val) {
            regRoleSelect.style.display = "inline-block";
            labelRegRole.style.display = "inline-block";
        } else {
            regRoleSelect.style.display = "none";
            labelRegRole.style.display = "none";
            regRoleSelect.value = "";
        }
    });
    // ================= STAMPA AUTOMATICA COMANDE =================
    const toggleStampaBtn = document.getElementById("toggleStampaComande");
    const stampaRef = db.ref("impostazioni/stampaAutomaticaComande");

    initToggle(toggleStampaBtn, stampaRef, {on: "ON", off: "OFF"}, true, val => {
        window.settings.stampaAutomaticaComande = val;
    });
    // SUONO GLOBALE
    const toggleSuonoBtn = document.getElementById("toggleSuonoBtn");
    const suonoRef = db.ref("impostazioni/suono");
    initToggle(toggleSuonoBtn, suonoRef, {on: "🔔 ON", off: "🔕 OFF"}, true, val => {
        window.settings.suono = val;
    });

    // NUOVE COMANDE IN ALTO CUCINA
    const toggleNuoveInAltoCucinaBtn = document.getElementById("toggleNuoveInAltoCucinaBtn");
    const nuoveInAltoCucinaRef = db.ref("impostazioni/nuoveInAltoCucina");
    initToggle(toggleNuoveInAltoCucinaBtn, nuoveInAltoCucinaRef, {on: "ON", off: "OFF"}, true, val => {
        window.settings.nuoveInAltoCucina = val;
        if (ruolo === "cucina") {
            caricaComandePerRuolo(
                document.getElementById("daFareTab"),
                document.getElementById("storicoTab"),
                "cucina"
            );
        }
    });
    // NUOVE COMANDE IN ALTO BERE
    const toggleNuoveInAltoBereBtn = document.getElementById("toggleNuoveInAltoBereBtn");
    const nuoveInAltoBereRef = db.ref("impostazioni/nuoveInAltoBere");
    initToggle(toggleNuoveInAltoBereBtn, nuoveInAltoBereRef, {on: "ON", off: "OFF"}, true, val => {
        window.settings.nuoveInAltoBere = val;
        if (ruolo === "bere") {
            caricaComandePerRuolo(
                document.getElementById("daFareTab"),
                document.getElementById("storicoTab"),
                "bere"
            );
        }
    });
    // SUONO CASSA (ingredienti critici)
    const toggleSuonoCassaBtn = document.getElementById("toggleSuonoCassaBtn");
    const suonoCassaRef = db.ref("impostazioni/suonoCassa");
    initToggle(toggleSuonoCassaBtn, suonoCassaRef, {on: "🔔 ON", off: "🔕 OFF"}, true, val => {
        window.settings.suonoCassa = val;
    });
    // ================= PULSANTE CANCELLA COMANDE =================
    const cancellaComandeBtn = document.getElementById("cancellaComandeBtn");
    if (cancellaComandeBtn) {
        cancellaComandeBtn.onclick = async () => {
            if (!checkOnline(true)) return;

            // Usa disonotify con pulsanti conferma / annulla
            disonotify("⚠️ Sei sicuro di voler eliminare tutte le comande? Questa operazione non può essere annullata.", {
                confirmText: "Elimina",
                showCancel: true,
                cancelText: "Annulla",
                onConfirm: async () => {
                    try {
                        await db.ref("comande").remove();
                        notify("✅ Tutte le comande sono state eliminate con successo!", "info");

                        // Aggiorna la lista comande admin se visibile
                        const listaComandeAdmin = document.getElementById("listaComandeAdmin");
                        if (listaComandeAdmin) listaComandeAdmin.innerHTML = "";
                    } catch (err) {
                        console.error(err);
                        notify("❌ Errore durante l'eliminazione delle comande: " + err.message, "error");
                    }
                },
                onCancel: () => {
                    notify("Operazione annullata", "attenzione");
                }
            });
        };
    }
    // ================= PULSANTE RESET CHAT =================
    const resetChatBtn = document.getElementById("resetChatBtn");
    if (resetChatBtn) {
        resetChatBtn.onclick = async () => {
            if (!checkOnline(true)) return;

            disonotify("⚠️ Sei sicuro di voler resettare la chat? Tutti i messaggi e le notifiche saranno eliminati.", {
                confirmText: "Reset",
                showCancel: true,
                cancelText: "Annulla",
                onConfirm: async () => {
                    try {
                        // 1️⃣ Cancella tutti i messaggi dal DB
                        await db.ref("chat/messaggi").remove();

                        // 2️⃣ Pulisce il localStorage di tutti gli utenti
                        Object.keys(localStorage).forEach(key => {
                            if (key.startsWith("chatNotificati_")) {
                                localStorage.removeItem(key);
                            }
                        });

                        // ✅ Notifica conferma
                        notify("✅ Chat resettata correttamente!", "info");
                    } catch (err) {
                        console.error(err);
                        notify("❌ Errore durante il reset della chat: " + err.message, "error");
                    }
                },
                onCancel: () => {
                    notify("Operazione annullata", "attenzione");
                }
            });
        };
    }
    // CASELLA ASPORTO
    const toggleAsportoBtn = document.getElementById("toggleAsportoBtn");
    const asportoRef = db.ref("impostazioni/asportoAbilitato");
    initToggle(toggleAsportoBtn, asportoRef, {on: "ON", off: "OFF"}, false, val => {
        window.settings.asportoAbilitato = val;
        const box = document.getElementById("asportoContainer");
        if (box) box.style.display = val ? "block" : "none";
    });
    // SUONO CHAT
    const toggleSuonoChatBtn = document.getElementById("toggleSuonoChatBtn");
    const suonoChatRef = db.ref("impostazioni/suonoChat");
    initToggle(toggleSuonoChatBtn, suonoChatRef, {on: "🔔 ON", off: "🔕 OFF"}, true, val => {
        window.settings.suonoChat = val;
    });
    // ================= PROFILO SNACK =================
    const toggleSnackBtn = document.getElementById("toggleSnackBtn");
    const snackRef = db.ref("impostazioni/snackAbilitato");
    initToggle(toggleSnackBtn, snackRef, {on: "ON", off: "OFF"}, false, val => {
        window.settings.snackAbilitato = val;
    });
    aggiornaSelectRuoliSnack();
    snackRef.on("value", snap => {
        window.settings.snackAbilitato = !!snap.val();
        caricaUtenti(); // 🔁 ricarica la lista con o senza Snack
    });
    snackRef.on("value", snap => {
        window.settings.snackAbilitato = !!snap.val();
        caricaUtenti(); // 🔁 ricarica la lista con o senza Snack
        aggiornaTickSnackPreordini(); // 🔹 Aggiorna tick note destinazioni subito
    });

    // 🔹 TOGGLE NUOVE COMANDE IN ALTO SNACK
    const toggleNuoveInAltoSnackBtn = document.getElementById("toggleNuoveInAltoSnackBtn");
    const divNuoveSnack = document.getElementById("settingNuoveInAltoSnack");
    const nuoveInAltoSnackRef = db.ref("impostazioni/nuoveInAltoSnack");

    // Funzione per mostrare/nascondere il toggle secondo snackAbilitato
    function aggiornaVisibilitaToggleSnack() {
        if (!divNuoveSnack) return;
        divNuoveSnack.style.display = window.settings.snackAbilitato ? "flex" : "none";
    }
    aggiornaVisibilitaToggleSnack();

    // Inizializza toggle sicuro (come gli altri)
    initToggle(toggleNuoveInAltoSnackBtn, nuoveInAltoSnackRef, {on:"ON", off:"OFF"}, window.settings.nuoveInAltoSnack, val => {
        window.settings.nuoveInAltoSnack = val;

        // Se ruolo corrente è snack, ricarica comande con nuovo ordine
        if (ruolo === "snack") {
            caricaComandePerRuolo(
                document.getElementById("daSnackComandeContainer"),
                document.getElementById("storicoSnackComandeContainer"),
                "snack"
            );
        }
    });

    // Aggiorna visibilità se cambia stato snack
    snackRef.on("value", snap => {
        window.settings.snackAbilitato = !!snap.val();
        aggiornaVisibilitaToggleSnack();
    });
    // 🔹 TOGGLE NOTE MULTIDESTINAZIONE
    const toggleNoteDestinazioniBtn = document.getElementById("toggleNoteDestinazioniBtn");
    const noteDestinazioniRef = db.ref("impostazioni/noteDestinazioniAbilitate");
    initToggle(toggleNoteDestinazioniBtn, noteDestinazioniRef, {on:"ON", off:"OFF"}, false, val => {
        window.settings.noteDestinazioniAbilitate = val;
        // 🔹 Rerender preordini già caricati
        if (window.isLoggedInAdmin) renderPreordiniAdmin(ultimiPreordini);
        if (window.isLoggedInCassa) renderPreordiniCassa(ultimiPreordini);
    });
    // ================= PREORDINI =================
    const togglePreordiniBtn = document.getElementById("togglePreordiniBtn");
    const preordiniAbilitatiRef = db.ref("impostazioni/preordiniAbilitati");
    const letteraPreordiniRef = db.ref("impostazioni/letteraPreordini");
    const settingLetteraPreordini = document.getElementById("settingLetteraPreordini");
    const inputLetteraPreordini = document.getElementById("inputLetteraPreordini");
    const preordiniTabBtnCassa = document.getElementById("preordiniTabBtn");
    const preordiniTabAdmin = document.getElementById("preordiniAdminTab");

    initToggle(togglePreordiniBtn, preordiniAbilitatiRef, { on: "ON", off: "OFF" }, false, val => {
        window.settings.preordiniAbilitati = val;

        // Mostra/Nascondi tab Cassa/Admin
        if (preordiniTabBtnCassa) preordiniTabBtnCassa.style.display = val ? "inline-block" : "none";
        if (preordiniTabAdmin) preordiniTabAdmin.classList.toggle("hidden", !val);

        // Mostra/Nascondi campo lettera preordini
        if (settingLetteraPreordini) settingLetteraPreordini.style.display = val ? "flex" : "none";

        // Blocca subito la pagina clienti se aperta
        const inviaBtn = document.getElementById("inviaPreordineBtn");
        if (inviaBtn) {
            inviaBtn.disabled = !val;
            inviaBtn.innerText = val ? "📩 Invia Preordine" : "⚠ Preordini disabilitati";
        }

        // Disabilita tutti i bottoni "Aggiungi" in Admin
        document.querySelectorAll(".order.admin-preordine .aggiungi").forEach(btn => {
            btn.disabled = !val;
        });

        // Riempi eventualmente messaggio di avviso nella pagina clienti
        const menuDiv = document.getElementById("menuClienti");
        if (menuDiv && !val) menuDiv.innerHTML = "<p>I preordini sono disabilitati.</p>";
    });

    // 🔹 Leggi valore lettera dal DB e aggiorna input
    letteraPreordiniRef.once("value").then(snap => {
        const val = snap.val() || "D";
        inputLetteraPreordini.value = val.toUpperCase();
        window.settings.letteraPreordini = val.toUpperCase();
    });

    // 🔹 Salva lettera quando cambia
    inputLetteraPreordini.onchange = async () => {
        const val = inputLetteraPreordini.value.toUpperCase();
        if (/^[A-Z]$/.test(val)) {
            await letteraPreordiniRef.set(val);
            window.settings.letteraPreordini = val;
            notify(`Lettera preordini impostata su ${val}`, "info");
        } else {
            notify("Lettera non valida. Usa una singola lettera (A-Z).", "warn");
            inputLetteraPreordini.value = window.settings.letteraPreordini || "D";
        }
    };
    // 🔹 SUONO NOTIFICHE PREORDINI (solo se preordini abilitati)
    const toggleSuonoPreordiniBtn = document.getElementById("toggleSuonoPreordiniBtn");
    const settingSuonoPreordiniDiv = document.getElementById("settingSuonoPreordini");
    const suonoPreordiniRef = db.ref("impostazioni/suonoPreordini");

    function aggiornaVisibilitaSuonoPreordini() {
        if (!settingSuonoPreordiniDiv) return;
        const preordiniOn = window.settings.preordiniAbilitati ?? false;
        settingSuonoPreordiniDiv.style.display = preordiniOn ? "flex" : "none";
    }

    // inizializza toggle se presente
    if (toggleSuonoPreordiniBtn) {
        initToggle(toggleSuonoPreordiniBtn, suonoPreordiniRef, {on: "🔔 ON", off: "🔕 OFF"}, true, val => {
            window.settings.suonoPreordini = val;
        });

        // aggiorna visibilità iniziale
        aggiornaVisibilitaSuonoPreordini();

        // reagisce al cambio realtime dei preordini
        db.ref("impostazioni/preordiniAbilitati").on("value", snap => {
            const val = snap.exists() ? snap.val() === true : false;
            window.settings.preordiniAbilitati = val;
            aggiornaVisibilitaSuonoPreordini();
        });
    }
    // 🔹 ORDINA PREORDINI
    const toggleOrdinaPreordiniBtn = document.getElementById("toggleOrdinaPreordiniBtn");
    const settingOrdinaPreordiniDiv = document.getElementById("settingOrdinaPreordini");
    const ordinaPreordiniRef = db.ref("impostazioni/ordinaPreordini");

    // Funzione per aggiornare visibilità (solo se preordini abilitati)
    function aggiornaVisibilitaOrdinaPreordini() {
        if (!settingOrdinaPreordiniDiv) return;
        const preordiniOn = window.settings.preordiniAbilitati ?? false;
        settingOrdinaPreordiniDiv.style.display = preordiniOn ? "flex" : "none";
    }

    // Inizializza toggle se presente
    if (toggleOrdinaPreordiniBtn) {
    initToggle(toggleOrdinaPreordiniBtn, ordinaPreordiniRef, {on: "ON", off: "OFF"}, true, val => {
        window.settings.ordinaPreordini = val;

        // 🔹 Aggiorna subito lista preordini se Admin o Cassa
        if (window.isLoggedInAdmin) renderPreordiniAdmin({ ...ultimiPreordini });
        if (window.isLoggedInCassa) renderPreordiniCassa({ ...ultimiPreordini });
    });


        // Aggiorna visibilità iniziale
        aggiornaVisibilitaOrdinaPreordini();

        // Aggiorna visibilità quando cambia stato dei preordini
        db.ref("impostazioni/preordiniAbilitati").on("value", snap => {
            const val = snap.exists() ? snap.val() === true : false;
            window.settings.preordiniAbilitati = val;
            aggiornaVisibilitaOrdinaPreordini();
        });
    }
    // NUOVA IMPOSTAZIONE: richiedi numero e posizione
    const togglePreordiniInfoBtn = document.getElementById("togglePreordiniInfoBtn");
    const preordiniInfoRef = db.ref("impostazioni/preordiniRichiediInfo");
    if (togglePreordiniInfoBtn) {
        initToggle(togglePreordiniInfoBtn, preordiniInfoRef, {on:"ON", off:"OFF"}, false, val => {
            window.settings.preordiniRichiediInfo = val;

            // Aggiorna eventuali UI esistenti
            if (window.isLoggedInAdmin) renderPreordiniAdmin({...ultimiPreordini});
            if (window.isLoggedInCassa) renderPreordiniCassa({...ultimiPreordini});
        });

        // Visibilità toggle solo se preordini attivi
        db.ref("impostazioni/preordiniAbilitati").on("value", snap => {
            const preordiniOn = snap.exists() && snap.val() === true;
            togglePreordiniInfoBtn.parentElement.style.display = preordiniOn ? "flex" : "none";
        });
    }
    const nomeStandRef = db.ref("impostazioni/nomeStand");
    const inputNomeStand = document.getElementById("inputNomeStand");
    const saveNomeStandBtn = document.getElementById("saveNomeStandBtn");

    // Leggi valore iniziale dal DB
    nomeStandRef.once("value").then(snap => {
        inputNomeStand.value = snap.val() || "BistroBò";
        window.settings.nomeStand = inputNomeStand.value;
    });

    // Salvataggio click
    saveNomeStandBtn?.addEventListener("click", async () => {
        const val = inputNomeStand.value.trim() || "BistroBò";
        await nomeStandRef.set(val);
        window.settings.nomeStand = val;
        notify(`Nome stand aggiornato: ${val}`, "info");
    });

    // Aggiorna in realtime se cambia da altro admin
    nomeStandRef.on("value", snap => {
        const val = snap.val() || "BistroBò";
        window.settings.nomeStand = val;
        if (inputNomeStand) inputNomeStand.value = val;
    });
    // CHAT ABILITATA / DISABILITATA
    const toggleChatAbilitataBtn = document.getElementById("toggleChatAbilitataBtn");
    const chatAbilitataRef = db.ref("impostazioni/chatAbilitata");

    initToggle(toggleChatAbilitataBtn, chatAbilitataRef, {on:"ON", off:"OFF"}, true, val => {
        window.settings.chatAbilitata = val;

        // Nascondi/mostra impostazioni legate alla chat
        const suonoChatSetting = document.getElementById("toggleSuonoChatBtn")?.parentElement;
        const resetChatSetting = document.getElementById("resetChatBtn")?.parentElement;

        if (suonoChatSetting) suonoChatSetting.style.display = val ? "flex" : "none";
        if (resetChatSetting) resetChatSetting.style.display = val ? "flex" : "none";
    });

    // Aggiorna visibilità iniziale
    chatAbilitataRef.on("value", snap => {
        const val = snap.val() === true;
        window.settings.chatAbilitata = val;

        const suonoChatSetting = document.getElementById("toggleSuonoChatBtn")?.parentElement;
        const resetChatSetting = document.getElementById("resetChatBtn")?.parentElement;

        if (suonoChatSetting) suonoChatSetting.style.display = val ? "flex" : "none";
        if (resetChatSetting) resetChatSetting.style.display = val ? "flex" : "none";
    });

}
function initTickNoteDestinazioni() {
    // 🔹 Mostra/nasconde i tick destinazioni note in base all'impostazione
    db.ref("impostazioni/noteDestinazioniAbilitate").on("value", snap => {
        const attivo = !!snap.val();
        window.settings.noteDestinazioniAbilitate = attivo;
        const div = document.getElementById("noteDestinazioniDiv");
        if (div) div.style.display = attivo ? "block" : "none";
    });

    // 🔹 Mostra anche il tick Snack solo se attivo
    db.ref("impostazioni/snackAbilitato").on("value", snap => {
        const snackOn = !!snap.val();
        const labelSnack = document.getElementById("tickSnackLabel");
        if (labelSnack) labelSnack.style.display = snackOn ? "inline" : "none";
    });
}
function aggiornaTickSnackPreordini() {
    // Aggiorna tick destinazioni note in Admin e Cassa
    ["listaPreordiniAdmin", "listaPreordiniCassa"].forEach(listaId => {
        const lista = document.getElementById(listaId);
        if (!lista) return;

        lista.querySelectorAll(".order").forEach(orderDiv => {
            const id = orderDiv.querySelector(".note-destinazione")?.dataset.id;
            if (!id || !ultimiPreordini[id]) return;

            const p = ultimiPreordini[id];

            if (!p.note) return;

            // Ricrea checkbox solo per le destinazioni note
            const container = orderDiv.querySelector(".order-body > div:last-child");
            if (!container) return;

            const destinazioni = ["cucina","bere", ...(window.settings.snackAbilitato ? ["snack"] : [])];

            container.innerHTML = destinazioni.map(d => `
                <label style="margin-right:10px;">
                    <input type="checkbox" class="note-destinazione" data-id="${id}" data-destinazione="${d}" 
                        ${p.noteDestinazioni?.includes(d) ? "checked" : ""}>
                    ${d.charAt(0).toUpperCase() + d.slice(1)}
                </label>
            `).join("");
        });
    });
}
const settingLetteraPreordini = document.getElementById("settingLetteraPreordini");
const inputLetteraPreordini = document.getElementById("inputLetteraPreordini");
if (settingLetteraPreordini && inputLetteraPreordini) {
    // Mostra/nascondi solo se preordini ON
    function aggiornaVisibilitaLettera() {
        settingLetteraPreordini.style.display = window.settings.preordiniAbilitati ? "flex" : "none";
        inputLetteraPreordini.value = window.settings.letteraPreordini || "D";
    }
    aggiornaVisibilitaLettera();

    // Aggiorna valore al cambio
    inputLetteraPreordini.addEventListener("input", () => {
        const val = inputLetteraPreordini.value.toUpperCase();
        if (/^[A-Z]$/.test(val)) {
            window.settings.letteraPreordini = val;
            db.ref("impostazioni/letteraPreordini").set(val);
        }
    });

    // Listener DB
    db.ref("impostazioni/letteraPreordini").on("value", snap => {
        const val = snap.val() || "D";
        window.settings.letteraPreordini = val;
        inputLetteraPreordini.value = val;
    });
}
// =====================================================
// 🔹 Aggiunge "Snack" nei menu a tendina ruoli se attivo
// =====================================================
function aggiornaSelectRuoliSnack() {
    const snackAttivo = !!window.settings.snackAbilitato;

    // REGISTRAZIONE
    const regSelect = document.getElementById("regRole");
    if (regSelect) {
        const esisteSnack = [...regSelect.options].some(opt => opt.value === "snack");
        if (snackAttivo && !esisteSnack) {
            const opt = document.createElement("option");
            opt.value = "snack";
            opt.textContent = "Snack";
            regSelect.appendChild(opt);
        } else if (!snackAttivo && esisteSnack) {
            regSelect.querySelector("option[value='snack']").remove();
        }
    }

    // ADMIN - gestione utenti
    const adminSelect = document.getElementById("newRole");
    if (adminSelect) {
        const esisteSnack = [...adminSelect.options].some(opt => opt.value === "snack");
        if (snackAttivo && !esisteSnack) {
            const opt = document.createElement("option");
            opt.value = "snack";
            opt.textContent = "Snack";
            adminSelect.appendChild(opt);
        } else if (!snackAttivo && esisteSnack) {
            adminSelect.querySelector("option[value='snack']").remove();
        }
    }
}
// 🔹 Popola un select ruoli aggiungendo "Snack" solo se abilitato
async function popolaSelectRuoliConSnack(selectEl) {
    if (!selectEl) return;

    try {
        const snapSnack = await db.ref("impostazioni/snackAbilitato").once("value");
        const snackAttivo = snapSnack.exists() && snapSnack.val() === true;

        // Ruoli base
        const ruoli = ["", "cassa", "cucina", "bere"];
        if (snackAttivo) ruoli.push("snack");

        // Ripulisci select e ripopola
        selectEl.innerHTML = '<option value="" selected>-- Seleziona ruolo --</option>';
        ruoli.forEach(r => {
            const opt = document.createElement("option");
            opt.value = r;
            opt.textContent = r.charAt(0).toUpperCase() + r.slice(1);
            selectEl.appendChild(opt);
        });
    } catch (err) {
        console.warn("Errore lettura snackAbilitato:", err);
    }
}
//------------INGREDIENTI CRITICI----------------
function aggiornaListaIngredientiCritici(force=false) {
    if (ruolo !== "cassa" && !force) return;
    if (!checkOnline(true)) return;
    const listaCritica = [];
    for (const id in ingredientData) {
        const ing = ingredientData[id];
        let rimanente = (ing.rimanente === null || ing.rimanente === undefined) ? null : Number(ing.rimanente);
        const unita = (ing.unita || "pz").toLowerCase();
        const sogliaAtt = sogliePerUnita[unita]?.attenzione ?? 15;
        const sogliaCrit = sogliePerUnita[unita]?.critica ?? 5;

        if (rimanente !== null && !isNaN(rimanente) && rimanente <= sogliaAtt) {
            listaCritica.push({
                id,
                nome: ing.nome || id,
                rimanente: rimanente,
                unita: unita,
                critico: rimanente <= sogliaCrit,
                sogliaAtt: sogliaAtt,   // aggiungi questa riga
                sogliaCrit: sogliaCrit  // aggiungi questa riga
            });
        }

    }

    const btnTab = document.getElementById("ingredientiCriticiTabBtn");
    const tabDiv = document.getElementById("ingredientiCriticiTab");
    const container = document.getElementById("listaIngredientiCritici");

    // Mostra/nascondi bottone del tab
    btnTab.style.display = listaCritica.length > 0 ? "inline-block" : "none";

    // Popola contenuto della tab
    container.innerHTML = "";
    listaCritica.forEach(i => {
        const r = document.createElement("div");
        r.style.padding = "4px 6px";
        r.style.marginBottom = "4px";
        r.style.border = `1px solid ${i.critico ? "red" : "orange"}`;
        r.style.borderRadius = "5px";
        r.innerHTML = `${i.nome} <span style="color:${i.critico ? "red" : "orange"}">(${i.rimanente})</span> ${i.critico ? "⚠️" : ""}`;
        container.appendChild(r);
    });

    // Lampeggio bottone
    btnTab.style.animation = listaCritica.some(i => i.critico)
        ? "blinkRed 1s ease-in-out 6"
        : listaCritica.length > 0 ? "blinkOrange 1s ease-in-out 6" : "";

    // Alert critici/attenzione
    listaCritica.forEach(i => {
        const statoAttuale = i.critico ? "critico" : "attenzione";
        const statoPrecedente = ingredientiCriticiPrecedenti.get(i.id) || "ok";

        if (statoPrecedente === "ok" && statoAttuale === "attenzione") {
            notify(`⚠️ Attenzione: ${i.nome} è sceso a ${i.rimanente} ${i.unita} (≤${i.sogliaAtt})`, "attenzione");
        }

        if ((statoPrecedente === "ok" || statoPrecedente === "attenzione") && statoAttuale === "critico") {
            notify(`🚨 CRITICO: ${i.nome} è sceso a ${i.rimanente} ${i.unita} (≤${i.sogliaCrit})`, "critico");
        }

        ingredientiCriticiPrecedenti.set(i.id, statoAttuale);
    });


    // Pulizia ingredienti tornati normali
    for (const id of Array.from(ingredientiCriticiPrecedenti.keys())) {
        if (!listaCritica.find(i => i.id === id)) ingredientiCriticiPrecedenti.delete(id);
    }

    // Listener click sul bottone del tab
    btnTab.onclick = () => {
        // Rimuove active da tutte le tab
        document.querySelectorAll('#cassaDiv .tabContent').forEach(t => t.classList.remove('active'));
        // Attiva solo ingredienti critici
        tabDiv.classList.add('active');

        // Aggiorna active sui bottoni
        document.querySelectorAll('#cassaDiv .tabBtn').forEach(b => b.classList.remove('active'));
        btnTab.classList.add('active');
    };
}
function initIngredientiCriticiListeners(force=false) {
    if (ruolo !== "cassa" && !force) return;

    // Primo caricamento snapshot
    db.ref("ingredienti").once("value")
        .then(snap => {
            ingredientData = snap.val() || {};
            aggiornaListaIngredientiCritici(force);
        })
        .catch(err => console.error("Errore inizializzazione ingredienti:", err));

    // Listener realtime
    db.ref("ingredienti").on("value", snap => {
        ingredientData = snap.val() || {};
        aggiornaListaIngredientiCritici(force);
    });
}
// ---------------- Helper per scalare ingredienti ----------------
function calcolaRichiesteDaPiatti(piatti) {
    if (!checkOnline(true)) return;
  const byId = {};
  const byName = {};
  (piatti || []).forEach(p => {
    const q = p.quantita || 1;
    (p.ingredienti || []).forEach(ing => {
      if (ing.id) {
        byId[ing.id] = (parseFloat(byId[ing.id]) || 0) + (parseFloat(ing.qtyPerUnit || 1) * parseFloat(q || 1));
      } else if (ing.nome) {
        const n = (ing.nome || "").trim().toLowerCase();
        byName[n] = (parseFloat(byName[n]) || 0) + (parseFloat(ing.qtyPerUnit || 1) * parseFloat(q || 1));
      }
    });
  });
  return { byId, byName };
}
async function applicaDecrementiIngredienti(richieste) {
    if (!checkOnline(true)) return;
  const snap = await db.ref("ingredienti").once("value");
  const ingData = snap.val() || {};

  const nomeToKey = {};
  for (const k in ingData) {
    const n = (ingData[k].nome || "").trim().toLowerCase();
    if (n) nomeToKey[n] = k;
  }

  const jobs = [];
  for (const id in richieste.byId) {
    const need = richieste.byId[id];
    if (ingData[id]) jobs.push({ id, need });
  }
  for (const nameLow in richieste.byName) {
    const need = richieste.byName[nameLow];
    const mapped = nomeToKey[nameLow];
    if (mapped) {
      const existing = jobs.find(j => j.id === mapped);
      if (existing) existing.need += need; else jobs.push({ id: mapped, need });
    } else {
      // non in DB => consideralo illimitato => ignora
    }
  }

  for (const j of jobs) {
    const curr = ingData[j.id];
    if (!curr) continue;
    if (curr.rimanente !== null && curr.rimanente !== undefined) {
      if (parseFloat(curr.rimanente) < parseFloat(j.need)) {
        return { success: false, message: `Quantità insufficiente per ${curr.nome || j.id} (necessarie ${j.need}, disponibili ${curr.rimanente})` };
      }
      if (curr.disponibile === false) {
        return { success: false, message: `Ingrediente ${curr.nome || j.id} non disponibile` };
      }
    }
  }

  const tPromises = jobs.map(j => {
    return db.ref("ingredienti/" + j.id).transaction(current => {
      if (!current) return current;
      if (current.rimanente === null || typeof current.rimanente === "undefined") return current;
      if (current.rimanente < j.need) return;
      const nuovo = parseFloat(current.rimanente || 0) - parseFloat(j.need || 0);
      return {
        ...current,
        rimanente: nuovo,
        disponibile: nuovo > 0
      };
    }).then(res => ({ id: j.id, result: res }));
  });

  const results = await Promise.all(tPromises);

  const failed = results.filter(r => !r.result || !r.result.committed);
  if (failed.length === 0) return { success: true };

  const committed = results.filter(r => r.result && r.result.committed).map(r => ({ id: r.id }));
  try {
    const revertPromises = committed.map(c => {
      const need = (jobs.find(j => j.id === c.id) || {}).need || 0;
      if (need <= 0) return Promise.resolve();
      return db.ref("ingredienti/" + c.id).transaction(curr => {
        if (!curr) return curr;
        if (curr.rimanente === null || typeof curr.rimanente === "undefined") return curr;
        const nuova = (curr.rimanente || 0) + need;
        return {
          ...curr,
          rimanente: nuova,
          disponibile: nuova > 0
        };
      });
    });
    await Promise.all(revertPromises);
  } catch (e) {
    console.error("Errore durante revert transazioni:", e);
  }

  const firstFailId = failed[0].id;
  const info = ingData[firstFailId] ? ingData[firstFailId].nome : firstFailId;
  return { success: false, message: `Conflitto / transazione non completata per ${info}. Operazione annullata.` };
}
async function applicaIncrementiIngredienti(byIdMap) {
    if (!checkOnline(true)) return;
  const jobs = Object.keys(byIdMap).map(id => ({ id, need: byIdMap[id] }));
  const promises = jobs.map(j => {
    return db.ref("ingredienti/" + j.id).transaction(curr => {
      if (!curr) return curr;
      if (curr.rimanente === null || typeof curr.rimanente === "undefined") {
        // illimitato -> niente da fare ma assicurati disponibile=true
        return { ...curr, disponibile: true };
      }
      const nuova = parseFloat(curr.rimanente || 0) + parseFloat(j.need || 0);
      return { ...curr, rimanente: nuova, disponibile: nuova > 0 };
    }).then(r => ({ id: j.id, result: r }));
  });

  const results = await Promise.all(promises);
  const failed = results.filter(r => !r.result || !r.result.committed);
  if (failed.length) {
    console.error("Errore incrementi per:", failed.map(f => f.id));
    return { success: false, failed };
  }
  return { success: true };
}
async function applicaDecrementoSingolo(id, qty) {
    if (!checkOnline(true)) return;
  const res = await db.ref("ingredienti/" + id).transaction(curr => {
    if (!curr) return curr;
    if (curr.rimanente === null || typeof curr.rimanente === "undefined") return curr; // illimitato -> non toccare
    if (parseFloat(curr.rimanente) < parseFloat(qty)) return;
    const nuovo = parseFloat(curr.rimanente || 0) - parseFloat(qty || 0);

    return { ...curr, rimanente: nuovo, disponibile: nuovo > 0 };
  });

  if (!res || !res.committed) {
    const info = (res && res.snapshot && res.snapshot.val && res.snapshot.val().nome) || id;
    return { success: false, message: `Impossibile riservare ${qty} di ${info}` };
  }
  return { success: true };
}
async function applicaIncrementoSingolo(id, qty) {
    if (!checkOnline(true)) return;
  const res = await db.ref("ingredienti/" + id).transaction(curr => {
    if (!curr) return curr;
    if (curr.rimanente === null || typeof curr.rimanente === "undefined") return { ...curr, disponibile: true };
    const nuova = parseFloat(curr.rimanente || 0) + parseFloat(qty || 0);
    return { ...curr, rimanente: nuova, disponibile: nuova > 0 };
  });
  if (!res || !res.committed) {
    console.error("Errore applicaIncrementoSingolo", id, qty);
    return { success: false };
  }
  return { success: true };
}

document.getElementById("tornaLoginBtn").onclick = () => {
    registerDiv.classList.add("hidden");
    loginDiv.classList.remove("hidden");
};

// -------------------- LOGIN --------------------
document.getElementById("loginBtn").addEventListener("click", async () => {
    const email = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;

    if (!email || !password) {
        notify("⚠️ Inserisci email e password", "warn");
        return;
    }
    showLoader();
    try {
        const res = await auth.signInWithEmailAndPassword(email, password);
        uid = res.user.uid;

        // controllo email verificata
        if (!res.user.emailVerified) {
            notify("📧 Devi prima verificare la tua email.\n👉 Controlla anche nella cartella SPAM.", "warn");
            await auth.signOut();
            return;
        }

        // controllo esistenza dati utente in DB
        const snap = await db.ref("utenti/" + uid).once("value");
        if (!snap.exists()) {
            notify("❌ Utente non autorizzato!", "error");
            await auth.signOut();
            return;
        }

        const userData = snap.val();
        if (userData.attivo === false) {
            notify("❌ Il tuo account è temporaneamente disattivato.", "error");
            await auth.signOut();
            return;
        }


        // controllo approvazione admin
        if (!userData.approvato) {
            notify("✅ La tua email è verificata!\n🛠️ Ora contatta l’amministratore per ottenere l’approvazione.", "info");
            await auth.signOut();
            return;
        }

        // se tutto ok -> login completato
        ruolo = userData.ruolo;
        mostraSchermata();
        // ================== STATO ONLINE ==================
        const userStatusDatabaseRef = db.ref("/utenti/" + uid + "/status");
        const isOfflineForDatabase = {
            state: "offline",
            last_changed: firebase.database.ServerValue.TIMESTAMP,
        };
        const isOnlineForDatabase = {
            state: "online",
            last_changed: firebase.database.ServerValue.TIMESTAMP,
        };

        // Aggiorna subito lo stato a online
        await userStatusDatabaseRef.set(isOnlineForDatabase);

        // ================== FLAG GLOBALE ==================
        let isConnectionLost = false;

        // ================== LISTENER CONNESSIONE ==================
        db.ref(".info/connected").on("value", async (snapshot) => {
            const connected = snapshot.val();

            // 🟢 CLIENT ONLINE
            if (connected === true) {
                isConnectionLost = false; // reset flag

                // 🔹 Registra cosa fare quando il client si disconnette
                await userStatusDatabaseRef.onDisconnect().set({
                    state: "offline",
                    last_changed: firebase.database.ServerValue.TIMESTAMP
                });

                // 🔹 Aggiorna subito lo stato a online
                await userStatusDatabaseRef.set({
                    state: "online",
                    last_changed: firebase.database.ServerValue.TIMESTAMP
                });

                // 🔹 Aggiorna anche lo stato lato admin (facoltativo)
                if (ruolo !== "admin") {
                    await db.ref("/utenti/" + uid + "/status").set({
                        state: "online",
                        last_changed: firebase.database.ServerValue.TIMESTAMP
                    });
                }

                return;
            }

            // 🔴 CLIENT OFFLINE
            if (connected === false && !isConnectionLost) {
                isConnectionLost = true;

                // Mostra loader offline e blocca UI
                if (offlineLoader) offlineLoader.style.display = "flex"; // rimane visibile
                document.body.style.pointerEvents = "none";
                document.body.style.userSelect = "none";

                // Polling continuo finché torna online
                const interval = setInterval(async () => {
                    if (navigator.onLine) {
                        clearInterval(interval);

                        try {
                            // Aggiorna stato online prima del reload
                            await userStatusDatabaseRef.set({
                                state: "online",
                                last_changed: firebase.database.ServerValue.TIMESTAMP
                            });
                        } catch (e) {
                            console.warn("Impossibile aggiornare stato online:", e);
                        }

                        // Forza reload della pagina
                        location.reload();
                    }
                }, 1000);

                return; // non fare altro finché offline
            }
        });

        // ================== LOGOUT FORZATO SOLO PER UTENTI NON ADMIN ==================
        if (ruolo !== "admin") {
            if (statusListenerRef) userStatusDatabaseRef.off("value", statusListenerRef);

            statusListenerRef = snap => {
                const status = snap.val();

                if (status.state === "offline") {
                    if (status.forzato === true) {
                        // Disconnessione forzata dall’admin
                        disonotify(
                            "❌ Sei stato disconnesso dall’amministratore!",
                            {
                                confirmText: "Ricarica",
                                onConfirm: async () => {
                                    await auth.signOut();
                                    location.reload();
                                }
                            }
                        );
                    } else if (!logoutVolontario && navigator.onLine && !isConnectionLost) {
                        // Disconnessione per perdita di connessione
                        disonotify(
                            "⚠️ Connessione persa. La pagina verrà ricaricata.",
                            {
                                confirmText: "Ricarica",
                                onConfirm: async () => {
                                    location.reload();
                                }
                            }
                        );
                    }
                }
            };

            userStatusDatabaseRef.on("value", statusListenerRef);
        }
    } catch (err) {
        document.getElementById("loginMsg").innerText = "❌ " + err.message;
    } finally {
        hideLoader();
    }
});

// Mostra schermata corretta per ruolo
function initRuoloTab(ruolo) {
    if (!checkOnline(true)) return;
    const divId = ruolo === "cucina" ? "cucinaDiv" : ruolo === "snack" ? "snackDiv" : "bereDiv";
    const daFareTabId = ruolo === "cucina" ? "daFareTab" : ruolo === "snack" ? "daSnackTab" : "daBereTab";
    const storicoTabId = ruolo === "cucina" ? "storicoTab" : ruolo === "snack" ? "storicoSnackTab" : "storicoBereTab";
    if (ruolo === "cucina") {
        initRicercaComande("daFareComandeContainer", "cercaComandaCucina");
        initRicercaComande("storicoComandeContainer", "cercaComandaCucinaStorico");
    }
    if (ruolo === "bere") {
        initRicercaComande("daBereComandeContainer", "cercaComandaBere");
        initRicercaComande("storicoBereComandeContainer", "cercaComandaBereStorico");
    }
    else if (ruolo === "snack") {
        initRicercaComande("daSnackComandeContainer", "cercaComandaSnack");
        initRicercaComande("storicoSnackComandeContainer", "cercaComandaSnackStorico");
    }


    const menuTabId = ruolo === "cucina" ? "menuCucinaTab" : "menuBereTab"; // nuovo tab

    const div = document.getElementById(divId);
    div.classList.remove("hidden");

    let daFareCont, storicoCont;
    if (ruolo === "cucina") {
        daFareCont = document.getElementById("daFareComandeContainer");
        storicoCont = document.getElementById("storicoComandeContainer");
    } else if (ruolo === "bere") {
        daFareCont = document.getElementById("daBereComandeContainer");
        storicoCont = document.getElementById("storicoBereComandeContainer");
    } else if (ruolo === "snack") {
        daFareCont = document.getElementById("daSnackComandeContainer");
        storicoCont = document.getElementById("storicoSnackComandeContainer");
    }
    caricaComandePerRuolo(daFareCont, storicoCont, ruolo);

    // Mostra tab di default "Da fare"
    document.getElementById(daFareTabId).classList.add("active");

    // Carica ingredienti per il ruolo
    caricaIngredientiPerRuolo(ruolo);

    // ------------------- Popola il tab Menu informativo -------------------
    const menuContainer = ruolo === "cucina" ? 
            document.getElementById("menuCucinaContainer") : 
            ruolo === "bere" ? 
                document.getElementById("menuBereContainer") :
                document.getElementById("menuSnackContainer");  // nuovo ID per snack


    db.ref("menu").on("value", snap => {
        const data = snap.val() || {};
        menuContainer.innerHTML = "";
        menuContainer.style.display = "block"; // verticale

        if (ruolo === "cucina") {
            const snackAttivo = window.settings?.snackAbilitato || false;

            // --- Cibi: includi anche snack se disattivo ---
            const cibi = Object.values(data).filter(item => 
                item.categoria?.toLowerCase() === "cibi" || 
                (!snackAttivo && item.categoria?.toLowerCase() === "snack")
            );

            if (cibi.length > 0) {
                const cibiTitle = document.createElement("h4");
                cibiTitle.innerText = "Cibi";
                menuContainer.appendChild(cibiTitle);

                cibi.forEach(item => {
                    const divPiatto = creaPiattoDiv(item);
                    menuContainer.appendChild(divPiatto);
                    aggiungiIngredienti(item, menuContainer);
                });
            }

            // --- Snack: solo se attivo ---
            if (snackAttivo) {
                const snack = Object.values(data).filter(item => item.categoria?.toLowerCase() === "snack");
                if (snack.length > 0) {
                    const snackTitle = document.createElement("h4");
                    snackTitle.innerText = "Snack";
                    menuContainer.appendChild(snackTitle);

                    snack.forEach(item => {
                        const divPiatto = creaPiattoDiv(item);
                        menuContainer.appendChild(divPiatto);
                        aggiungiIngredienti(item, menuContainer);
                    });
                }
            }
        } else if (ruolo === "bere") {
            // --- Bevande ---
            const bevande = Object.values(data).filter(item => item.categoria?.toLowerCase() === "bevande");
            bevande.forEach(item => {
                const divPiatto = creaPiattoDiv(item);
                menuContainer.appendChild(divPiatto);
                aggiungiIngredienti(item, menuContainer);
            });
        } else if (ruolo === "snack") {
            const snackAttivo = window.settings?.snackAbilitato || false;
            if (snackAttivo) {
                const snack = Object.values(data).filter(i => i.categoria?.toLowerCase() === "snack");
                if (snack.length > 0) {
                    const snackTitle = document.createElement("h4");
                    snackTitle.innerText = "Snack";
                    menuContainer.appendChild(snackTitle);

                    snack.forEach(item => {
                        const divPiatto = creaPiattoDiv(item);
                        menuContainer.appendChild(divPiatto);
                        aggiungiIngredienti(item, menuContainer);
                    });
                }
            }
        }


    });

    // ------------------- Gestione click tab -------------------
    div.querySelectorAll(".tabBtn").forEach(btn => {
        btn.onclick = () => {
            div.querySelectorAll(".tabContent").forEach(t => t.classList.remove("active"));
            div.querySelectorAll(".tabBtn").forEach(b => b.classList.remove("active"));
            const tabId = btn.dataset.tab;
            document.getElementById(tabId).classList.add("active");
            btn.classList.add("active");
        };
    });

    // Click default sul tab Da fare
    div.querySelector(`.tabBtn[data-tab='${daFareTabId}']`).click();

    // --- Funzioni di supporto ---
    function creaPiattoDiv(item) {
        const divPiatto = document.createElement("div");
        divPiatto.className = "sconto-item";
        divPiatto.style.cursor = "default";
        divPiatto.style.display = "flex";
        divPiatto.style.justifyContent = "space-between";
        divPiatto.style.alignItems = "center";
        divPiatto.style.marginBottom = "2px";

        const nome = document.createElement("span");
        nome.innerText = item.nome;

        const prezzo = document.createElement("span");
        prezzo.innerText = `€${item.prezzo.toFixed(2)}`;

        divPiatto.appendChild(nome);
        divPiatto.appendChild(prezzo);

        return divPiatto;
    }

    function aggiungiIngredienti(item, container) {
        if (item.ingredienti && item.ingredienti.length > 0) {
            const ingDiv = document.createElement("div");
            ingDiv.style.margin = "2px 0 10px 15px";
            ingDiv.style.fontSize = "0.9em";
            ingDiv.style.color = "#555";

            item.ingredienti.forEach(ing => {
                const ingRow = document.createElement("div");
                // 🔹 usa sempre l’unità dal DB ingredienti
                const unita = (window.ingredientData?.[ing.id]?.unita) || ing.unita || "pz";
                const qty = ing.qtyPerUnit || 1;
                ingRow.innerText = `${ing.nome || ing.id}: ${qty} ${unita}`;
                ingDiv.appendChild(ingRow);
            });



            container.appendChild(ingDiv);
        }
    }
    function aggiornaMenuRuolo() {
        db.ref("menu").once("value").then(snap => {
            const data = snap.val() || {};
            menuContainer.innerHTML = "";

            if (ruolo === "cucina") {
                const snackAttivo = window.settings?.snackAbilitato || false;

                // Cibi: includi snack solo se snack disabilitato
                const cibi = Object.values(data).filter(i => 
                    i.categoria?.toLowerCase() === "cibi" || 
                    (!snackAttivo && i.categoria?.toLowerCase() === "snack")
                );

                if (cibi.length) {
                    const t = document.createElement("h4"); 
                    t.innerText = "Cibi";
                    menuContainer.appendChild(t);
                    cibi.forEach(item => {
                        const divP = creaPiattoDiv(item);
                        menuContainer.appendChild(divP);
                        aggiungiIngredienti(item, menuContainer);
                    });
                }

                // Snack: mostra solo se attivo
                if (!snackAttivo) {
                    const snack = Object.values(data).filter(i => i.categoria?.toLowerCase() === "snack");
                    if (snack.length) {
                        const t = document.createElement("h4"); 
                        t.innerText = "Snack";
                        menuContainer.appendChild(t);
                        snack.forEach(item => {
                            const divP = creaPiattoDiv(item);
                            menuContainer.appendChild(divP);
                            aggiungiIngredienti(item, menuContainer);
                        });
                    }
                }
            } else if (ruolo === "bere") {
                const bevande = Object.values(data).filter(i => i.categoria?.toLowerCase() === "bevande");
                const t = document.createElement("h4"); t.innerText = "Bevande";
                menuContainer.appendChild(t);
                bevande.forEach(item => {
                    const divP = creaPiattoDiv(item);
                    menuContainer.appendChild(divP);
                    aggiungiIngredienti(item, menuContainer);
                });
            } else if (ruolo === "snack") {
                const snack = Object.values(data).filter(i => i.categoria?.toLowerCase() === "snack");
                const t = document.createElement("h4"); t.innerText = "Snack";
                menuContainer.appendChild(t);
                snack.forEach(item => {
                    const divP = creaPiattoDiv(item);
                    menuContainer.appendChild(divP);
                    aggiungiIngredienti(item, menuContainer);
                });
            }

        });
    }
    // 🔹 Quando apro la tab menu del ruolo, aggiorna ingredienti e menu
    const menuTabBtn = div.querySelector(`[data-tab='${menuTabId}']`);
    if (menuTabBtn) {
        menuTabBtn.addEventListener("click", async () => {
            if (!checkOnline(true)) return;

            // Aggiorna ingredienti (per unità corrette)
            const snapIng = await db.ref("ingredienti").once("value");
            window.ingredientData = snapIng.val() || {};

            // 🔹 Ricrea il menu del ruolo
            aggiornaMenuRuolo();
        });
    }
    // 🔹 Ascolta cambiamenti in ingredienti in tempo reale
    db.ref("ingredienti").on("value", snap => {
        window.ingredientData = snap.val() || {};
        // Aggiorna immediatamente il menu visibile (se la scheda è aperta)
        aggiornaMenuRuolo();
    });

}
function mostraSchermata() {
    showLoader();
    inizializzaOrologio();
    // Nascondi sempre tutte le sezioni all'avvio
    document.getElementById("cassaDiv").classList.add("hidden");
    document.getElementById("adminDiv").classList.add("hidden");
    document.getElementById("cucinaDiv").classList.add("hidden");
    document.getElementById("bereDiv").classList.add("hidden");
    document.getElementById("snackDiv").classList.add("hidden");

    document.getElementById("loginWrapper").style.display = "none";
    document.getElementById("logoutDiv").classList.remove("hidden");
    
    initImpostazioniToggle();

    // Mostra schermata in base al ruolo
    if (ruolo === "cassa") { 
        if (!checkOnline(true)) return;
        window.isLoggedInCassa = true;
        window.isLoggedInAdmin = false;
        if (typeof initPreordiniInterni === "function") initPreordiniInterni();
        document.getElementById("cassaDiv").classList.remove("hidden"); 
        caricaMenuCassa();
        caricaComandeCassa();
        initIngredientiCriticiListeners();
        initTickNoteDestinazioni();
        hideLoader();
    } else if (ruolo === "admin") {
        if (!checkOnline(true)) return;
        window.isLoggedInAdmin = true;
        window.isLoggedInCassa = false;
        if (typeof initPreordiniInterni === "function") initPreordiniInterni();
        document.getElementById("adminDiv").classList.remove("hidden");
        initIngredientiAdminRealtime();
        caricaGestioneComandeAdmin();
        caricaStatistiche();
        caricaMenuAdmin();
        caricaUtenti();
        document.getElementById("comandeTab").classList.add("active");

        const passaBtn = document.getElementById("passaACassaBtn");
        passaBtn.style.display = "inline-block";
        passaBtn.onclick = mostraCassaDaAdmin;

        let utentiVisti = {};
        db.ref("utenti").once("value").then(snap => {
            snap.forEach(s => {
                const u = s.val();
                utentiVisti[s.key] = true;
                if (!u.approvato) {
                    notify("👤 Nuovo utente in attesa di approvazione: " + (u.username || "utente"), "info");
                }
            });

            db.ref("utenti").on("child_added", newSnap => {
                const id = newSnap.key;
                const u = newSnap.val();
                const tab = document.getElementById("tabUtenti");
                const tabActive = tab ? tab.classList.contains("active") : false;
                if (!u.approvato && !utentiVisti[id] && !tabActive) {
                    notify("👤 Nuovo utente in attesa di approvazione: " + (u.username || "utente"), "info");
                }
                utentiVisti[id] = true;
            });
        });
        hideLoader();
    } else if (ruolo === "cucina" || ruolo === "bere" || ruolo === "snack") {
        if (!checkOnline(true)) return;

        // 🔹 Mostra solo dopo che le impostazioni sono caricate e se lo snack è abilitato
        const snackDiv = document.getElementById("snackDiv");
        snackDiv.classList.add("hidden"); // forza sempre nascosto finché non si decide

            if (ruolo === "snack") {
                const attendiSnack = setInterval(() => {
                    if (window.settings && typeof window.settings.snackAbilitato !== "undefined") {
                        clearInterval(attendiSnack);
                        if (window.settings.snackAbilitato) {
                            snackDiv.classList.remove("hidden");
                            // Carica tab completo con menu e ingredienti
                            initRuoloTab("snack");
                        } else {
                            notify("⚠️ Il profilo Snack è disattivo nelle impostazioni.", "warning");
                            snackDiv.classList.add("hidden");
                        }
                        hideLoader();
                    }
                }, 200);
            } else {
            initRuoloTab(ruolo);
            hideLoader();
        }
    }
    initChat();
    // 🔹 ATTIVA I PREORDINI SOLO SE ABILITATI
    const attendiPreordini = setInterval(() => {
        if (window.settings && typeof window.settings.preordiniAbilitati !== "undefined") {
            clearInterval(attendiPreordini);
            if (window.settings.preordiniAbilitati && typeof initPreordini === "function") {
                initPreordini();
            }
        }
    }, 200);
}
// ================== CHAT INTERNA GLOBALE ==================
function ruoloCapitalizzato() {
  if (!ruolo) return "";
  return ruolo.charAt(0).toUpperCase() + ruolo.slice(1);
}
function initChat() {
  let chatContainer, chatInput, chatSendBtn;

  // 🔹 Caso normale: usa i div del ruolo corrente
  chatContainer = document.getElementById(`chatContainer${ruoloCapitalizzato()}`);
  chatInput = document.getElementById(`chatInput${ruoloCapitalizzato()}`);
  chatSendBtn = document.getElementById(`chatSend${ruoloCapitalizzato()}Btn`);

  // 🔹 Caso speciale: Admin dentro la sezione Cassa
  const adminInCassa = 
      ruolo === "admin" && 
      !document.getElementById("adminDiv").classList.contains("hidden") === false &&
      !document.getElementById("cassaDiv").classList.contains("hidden");

  if (adminInCassa) {
    chatContainer = document.getElementById("chatContainerCassa");
    chatInput = document.getElementById("chatInputCassa");
    chatSendBtn = document.getElementById("chatSendCassaBtn");
  }

  if (!chatContainer || !chatInput || !chatSendBtn) return;


  const chatRef = db.ref("chat/messaggi");
    // Recupera dal localStorage i messaggi già notificati per l'utente corrente
    const notificati = new Set(JSON.parse(localStorage.getItem("chatNotificati_" + uid) || "[]"));


  // 🔹 Mostra e aggiorna sempre gli ultimi 10 messaggi
  chatRef.limitToLast(10).on("value", snap => {
    const data = snap.val() || {};
    chatContainer.innerHTML = ""; // pulisci tutto
    Object.values(data)
      .sort((a, b) => a.timestamp - b.timestamp)
      .forEach(msg => {
        const div = document.createElement("div");
        div.className = "chat-message " + (msg.uid === uid ? "me" : "other");

        const sender = document.createElement("div");
        sender.className = "chat-sender";
        sender.textContent = msg.uid === uid ? "Tu" : `${msg.email} (${msg.ruolo})`;

        const text = document.createElement("div");
        text.textContent = msg.testo;

        div.appendChild(sender);
        div.appendChild(text);
        chatContainer.appendChild(div);
      });
        // 🔔 Notifica tutti i messaggi nuovi che non sono miei e non ancora notificati
        Object.values(data)
        .forEach(msg => {
            const msgKey = `${msg.uid}_${msg.timestamp}`;
            if (msg.uid !== uid && !notificati.has(msgKey)) {

                // Chat disabilitata → ignora tutto
                if (!window.settings.chatAbilitata) return;

                if (window.settings.suonoChat) riproduciSuonoNotifica();
                notify(`💬 Nuovo messaggio da: ${msg.email} (${msg.ruolo})`, "info");

                notificati.add(msgKey); // ✅ segna come notificato
                localStorage.setItem("chatNotificati_" + uid, JSON.stringify([...notificati])); // salva persistente

            }
        });
    chatContainer.scrollTop = chatContainer.scrollHeight;
  });

  // 🔹 Invio messaggio
  chatSendBtn.onclick = async () => {

    // 🔹 BLOCCO CHAT DISABILITATA
    if (!window.settings.chatAbilitata) {
        notify("💬 La chat è disabilitata dall'amministratore.", "warn");
        return;
    }
    const testo = chatInput.value.trim();
    if (!testo) return;

    const userSnap = await db.ref("utenti/" + uid).once("value");
    const user = userSnap.val() || {};

    const newMsg = {
      testo,
      ruolo: user.ruolo || ruolo || "sconosciuto",
      email: user.username || "anonimo",
      uid: uid,
      timestamp: Date.now()
    };

    // Invia messaggio
    await chatRef.push(newMsg);
    chatInput.value = "";

    // 🔹 Subito dopo l’invio, elimina i messaggi più vecchi
    const snap = await chatRef.once("value");
    const data = snap.val() || {};
    const keys = Object.keys(data);
    if (keys.length > 10) {
    const toDelete = keys
        .sort((a, b) => data[a].timestamp - data[b].timestamp)
        .slice(0, keys.length - 10);

    toDelete.forEach(k => {
        chatRef.child(k).remove(); // elimina dal DB

        // 🔹 rimuovi dal Set e localStorage
        const msg = data[k];
        if (msg) {
        const msgKey = `${msg.uid}_${msg.timestamp}`;
        notificati.delete(msgKey);
        }
    });

    // 🔹 aggiorna localStorage
    localStorage.setItem("chatNotificati_" + uid, JSON.stringify([...notificati]));
    }

  };
}
// --- PULSANTE PASSA A CASSA / TORNA AD ADMIN ---
const passaBtn = document.getElementById("passaACassaBtn");
function mostraCassaDaAdmin() {
    if (!checkOnline(true)) return;
    document.getElementById("adminDiv").classList.add("hidden");
    document.getElementById("cassaDiv").classList.remove("hidden");

    // Rimuove listener attivi di admin prima di passare a cassa
    db.ref("ingredienti").off();
    db.ref("comande").off();
    db.ref("menu").off();
    db.ref("utenti").off();    

    // Carica funzioni cassa anche per admin
    caricaMenuCassa();
    caricaComandeCassa();
    initIngredientiCriticiListeners(true);
    initChat();
    initTickNoteDestinazioni(); 
    // forza l'inizializzazione
    // Cambia testo e click del pulsante
    passaBtn.innerText = "Torna ad Admin";
    passaBtn.onclick = mostraAdminDaCassa;
    document.querySelector("#cassaDiv .tabBtn:first-child").click();
}
function mostraAdminDaCassa() {
    if (!checkOnline(true)) return;
    window.isLoggedInAdmin = true;
    window.isLoggedInCassa = false;
     document.getElementById("cassaDiv").classList.add("hidden");
     document.getElementById("adminDiv").classList.remove("hidden");

     // Rimuove TUTTI i listener realtime non necessari
     db.ref("ingredienti").off();
     db.ref("comande").off();
     db.ref("menu").off();
     db.ref("utenti").off();

     caricaIngredienti();
     caricaGestioneComandeAdmin()
     caricaStatistiche();
     caricaMenuAdmin();
     caricaUtenti();
     // Ripristina pulsante per tornare a cassa 
     passaBtn.innerText = "Passa a Cassa";
     passaBtn.onclick = mostraCassaDaAdmin;
     document.querySelector("#adminDiv .tabBtn:first-child").click();
}
// REGISTRAZIONE utenti da admin
document.getElementById("registraBtn").onclick = async () => {
    const email = document.getElementById("newUsername").value.trim();
    const password = document.getElementById("newPass").value;
    const ruoloNuovo = document.getElementById("newRole").value;

    if(!email || !password){ notify("Compila tutti i campi", "warn"); return; }

    try{
        const res = await auth.createUserWithEmailAndPassword(email,password);
        await res.user.sendEmailVerification();
        await db.ref("utenti/"+res.user.uid).set({
    		username: email,
    		ruolo: ruoloNuovo,
    		approvato: true,
            attivo: true   
        });
        notify("Utente creato con successo e approvato automaticamente!", "info");
        document.getElementById("newUsername").value = "";
        document.getElementById("newPass").value = "";
        document.getElementById("newRole").value = "";
    } catch(err){
        notify(err.message, "warn");
    }
caricaUtenti();
};

// -------------------- LOGOUT --------------------
document.getElementById("logoutBtn").addEventListener("click", async () => {
    logoutVolontario = true; // segnala logout manuale
    try {
        // rimuove listener stato
        if(statusListenerRef && uid){
            const userStatusDatabaseRef = db.ref("/utenti/" + uid + "/status");
            userStatusDatabaseRef.off("value", statusListenerRef);
            statusListenerRef = null;
        }

        db.ref("ingredienti").off();
        db.ref("comande").off();
        db.ref("utenti").off();
        db.ref("menu").off();
        firebase.database().ref().off();
        if(uid){
            await db.ref("/utenti/" + uid + "/status").set({
                state: "offline",
                last_changed: firebase.database.ServerValue.TIMESTAMP
            });
        }

        await auth.signOut();
        location.reload();
    } catch(e){ console.warn(e); }
});

// -------------------- FUNZIONI COMANDE --------------------
//lettere e numero comande
document.getElementById("letteraComanda").addEventListener("input", function() {
    this.value = this.value.replace(/[^a-zA-Z]/g, '').toUpperCase();
});
// separa comanda in cibo/snack e bevande
function separaComanda(items) {
    if (!Array.isArray(items)) return { cibo: [], bere: [], snack: [] };

    let cibo = [];
    let bere = [];
    let snack = [];

    // 🔹 Legge lo stato globale dell’impostazione
    const snackAbilitato = window.settings?.snackAbilitato === true;

    items.forEach(i => {
        const categoria = (i.categoria || "").toLowerCase();
        const tipo = (i.tipo || "").toLowerCase();
        const nome = (i.nome || "").toLowerCase();

        if (categoria === "bevande" || tipo === "bere") {
            bere.push(i);
        } 
        else if (
            categoria === "snack" ||
            categoria.includes("fritti") ||
            tipo === "snack" ||
            nome.includes("patatine") || nome.includes("fritto") // utile per casi pratici
        ) {
            if (snackAbilitato) {
                snack.push(i);
            } else {
                cibo.push(i); // se snack disattivato → trattalo come cibo
            }
        } 
        else {
            cibo.push(i);
        }
    });

    return { cibo, bere, snack };
}
async function caricaMenuCassa() {
    if (!checkOnline(true)) return;
    showLoader();

    window.menuButtons = {}; // Salva tutti i bottoni

    const menuCibiDiv = document.getElementById("menuCibi");
    const menuBevandeDiv = document.getElementById("menuBevande");
    const menuSnackDiv = document.getElementById("menuSnack");

    const menuRef = db.ref("menu");
    const ingredientiRef = db.ref("ingredienti");

    // --- CREA BOTTONI UNA SOLA VOLTA ---
    function renderMenuCassa() {
        if (!window.menuData || !window.ingredientData) return;

        menuCibiDiv.innerHTML = "<h3>Cibi</h3>";
        menuBevandeDiv.innerHTML = "<h3>Bevande</h3>";
        menuSnackDiv.innerHTML = "<h3>Snack</h3>";

        Object.entries(window.menuData || {}).forEach(([id, item]) => {
            let btn = window.menuButtons[id];

            if (!btn) {
                btn = document.createElement("button");
                btn.dataset.menuId = id;


                // Click aggiungi comanda
                btn.onclick = () => {
                    const quantVal = document.getElementById("quantita").value;
                    const quant = parseInt(quantVal);
                    if (!quant || quant <= 0) { notify("Seleziona prima la quantità!", "warn"); return; }

                    const esiste = comandaCorrente.find(i => i.nome === item.nome);
                    if (esiste) {
                        esiste.quantita += quant;
                        esiste.sconto = item.sconto || null;
                        esiste.prezzo = item.prezzo;
                    } else {
                        comandaCorrente.push({
                            nome: item.nome,
                            prezzo: item.prezzo,
                            quantita: quant,
                            categoria: item.categoria,
                            ingredienti: item.ingredienti || [],
                            sconto: item.sconto || null
                        });
                    }
                    aggiornaComandaCorrente();
                };
                window.menuButtons[id] = btn;

                // Append al DOM
                const categoria = (item.categoria || "").toLowerCase();
                if (categoria === "cibi") menuCibiDiv.appendChild(btn);
                else if (categoria === "bevande") menuBevandeDiv.appendChild(btn);
                else if (categoria === "snack") menuSnackDiv.appendChild(btn);
            }

            // Aggiorno sempre contenuto e stili
            const wrapper = document.createElement("div");
            wrapper.style.textAlign = "center";
            wrapper.style.width = "100%";

            const nomeDiv = document.createElement("div");
            nomeDiv.textContent = item.nome;
            nomeDiv.style.fontWeight = "bold";
            wrapper.appendChild(nomeDiv);

            const prezzoDiv = document.createElement("div");
            prezzoDiv.innerText = item.sconto 
                ? `€${calcolaPrezzoConSconto(item).toFixed(2)}`
                : `€${item.prezzo.toFixed(2)}`;
            wrapper.appendChild(prezzoDiv);

            if (item.ingredienti && item.ingredienti.length) {
                const ingDiv = document.createElement("div");
                ingDiv.style.fontSize = "11px";
                ingDiv.style.color = "#444";
                ingDiv.style.marginTop = "4px";
                ingDiv.textContent = "Ingredienti: " + item.ingredienti.map(ing => ing.nome || ing.id).join(", ");
                wrapper.appendChild(ingDiv);
            }

            btn.innerHTML = "";
            btn.appendChild(wrapper);
            Object.assign(btn.style, {
                display: "block",
                width: "90%",
                padding: "3px 5px",
                borderRadius: "4px",
                border: "1px solid #aaa",
                background: "#f5f5f5",
                cursor: "pointer",
                color: "#000"
            });
        });

        hideLoader();
    }
    // Caricamento iniziale ingredienti + menu
    Promise.all([
        ingredientiRef.once("value"),
        menuRef.once("value")
    ]).then(([snapIng, snapMenu]) => {
        window.ingredientData = snapIng.val() || {};
        window.menuData = snapMenu.val() || {};

        renderMenuCassa();
        aggiornaBottoniBloccati();

        // Listener ingredienti
        ingredientiRef.on("value", snap => {
            window.ingredientData = snap.val() || {};
            // ❌ NON riscrivere menuData qui!
            // Aggiorna solo lo stato dei bottoni
            aggiornaBottoniBloccati();
        });


        // Listener menu
        menuRef.on("value", snap => {
            window.menuData = snap.val() || {};
            aggiornaBottoniBloccati();
        });

        // Listener blocco piatti manuale
        initBloccoPiattiListener();
    });

}
function initBloccoPiattiListener() {
    console.log(" [initBloccoPiattiListener] INIZIO");
    const menuRef = db.ref("menu");

    menuRef.on("value", snapMenu => {
        const data = snapMenu.val() || {};
        window.menuData = data;

        // Stato precedente per notifiche
        if (!window.statoPiattiPrecedente) {
            window.statoPiattiPrecedente = JSON.parse(JSON.stringify(data));
        } else {
            for (const id in data) {
                const nuovo = data[id];
                const vecchio = window.statoPiattiPrecedente[id];
                if (!vecchio) continue;

                if (vecchio.bloccato !== nuovo.bloccato) {
                    if (nuovo.bloccato === true) {
                        notify(`🚫 Il piatto "${nuovo.nome}" è stato bloccato dall'amministratore.`, "warn");
                        if (window.settings.suonoCassa) riproduciSuono("blocco");
                    } else {
                        notify(`✅ Il piatto "${nuovo.nome}" è stato sbloccato dall'amministratore.`, "info");
                        if (window.settings.suonoCassa) riproduciSuono("sblocco");
                    }
                }
            }
            window.statoPiattiPrecedente = JSON.parse(JSON.stringify(data));
        }

        // Aggiorna bottoni sempre, senza condizioni
        aggiornaBottoniBloccati();
    });
    console.log("[initBloccoPiattiListener] FINE");
}
function aggiornaBottoniBloccati() {
    console.log("🔵 [aggiornaBottoniBloccati] INIZIO");

    const ingData = window.ingredientData || {};
    const menuData = window.menuData || {};

    ["menuCibi", "menuBevande", "menuSnack"].forEach(sezioneId => {
        const container = document.getElementById(sezioneId);
        if (!container) return;

        const bottoni = Array.from(container.querySelectorAll("button"));

        bottoni.forEach(btn => {
            const id = btn.dataset.menuId;
            const item = menuData[id];
            if (!item) return;

            let disponibile = true;

            // Ingredienti non disponibili
            if (item.ingredienti && item.ingredienti.length) {
                for (const req of item.ingredienti) {
                    const ing = ingData[req.id];
                    if (ing && (
                        ing.disponibile === false ||
                        (ing.rimanente !== null && ing.rimanente < (req.qtyPerUnit || 1))
                    )) {
                        disponibile = false;
                        break;
                    }
                }
            }

            // Blocco manuale
            if (item.bloccato === true) disponibile = false;

            // --- Stile finale ---
            if (!disponibile) {
                btn.disabled = true;

                if (item.bloccato === true) {
                    // Bloccato manuale
                    Object.assign(btn.style, {
                        opacity: 0.6,
                        border: "2px solid #d9534f",
                        background: "#f8d7da"
                    });
                } else {
                    // Ingredienti insufficienti
                    Object.assign(btn.style, {
                        opacity: 0.5,
                        border: "2px dashed orange",
                        background: "#fff3cd"
                    });
                }
            } else {
                // Disponibile
                btn.disabled = false;
                Object.assign(btn.style, {
                    opacity: 1,
                    border: "1px solid #aaa",
                    background: "#f5f5f5"
                });
            }

        });
    });

    console.log("🔵 [aggiornaBottoniBloccati] FINE");
}
function aggiornaComandaCorrente(){
    if (!checkOnline(true)) return;
    const div=document.getElementById("comandaCorrente");
    div.innerHTML="";
    let tot=0;
    comandaCorrente.forEach((i,idx)=>{
        const d=document.createElement("div");
        d.style.display="flex"; d.style.justifyContent="space-between"; d.style.alignItems="center"; d.style.marginBottom="5px";

        const span=document.createElement("span");
        if(i.sconto){
            if(i.sconto.tipo === "percentuale"){
                span.innerHTML = `${i.quantita}x ${i.nome} 
                    <span style="text-decoration: line-through; color:red;">€${i.prezzo.toFixed(2)}</span> 
                    <span style="color:red;">€${calcolaPrezzoConSconto(i).toFixed(2)}</span>`;
            } else if(i.sconto.tipo === "x_paga_y"){
                span.innerText = `${i.quantita}x ${i.nome} (€${calcolaPrezzoConSconto(i).toFixed(2)})`;
            } else {
                span.innerText = `${i.quantita}x ${i.nome} (€${i.prezzo.toFixed(2)})`;
            }
        } else {
            span.innerText = `${i.quantita}x ${i.nome} (€${i.prezzo.toFixed(2)})`;
        }



        const controls = document.createElement("span");

        // pulsante -
        const btnMinus = document.createElement("button");
        btnMinus.innerText = "-";
        btnMinus.onclick = () => {
            if (i.quantita > 1) {
                i.quantita--;
            } else {
                comandaCorrente.splice(idx,1);
            }
            aggiornaComandaCorrente();
        };
        controls.appendChild(btnMinus);

        // pulsante +
        const btnPlus = document.createElement("button");
        btnPlus.innerText = "+";
        btnPlus.style.marginLeft = "5px";
        btnPlus.onclick = () => {
            i.quantita++;
            aggiornaComandaCorrente();
        };
        controls.appendChild(btnPlus);

        // pulsante elimina
        const btnDelete = document.createElement("button");
        btnDelete.innerText = "❌";
        btnDelete.style.marginLeft = "5px";
        btnDelete.onclick = () => {
            comandaCorrente.splice(idx,1); 
            aggiornaComandaCorrente(); 
        };
        controls.appendChild(btnDelete);

        d.appendChild(span); 
        d.appendChild(controls); 
        div.appendChild(d);


        tot += calcolaPrezzoConSconto(i);
    });
    document.getElementById("totale").innerText=tot.toFixed(2);

    // Aggiorna il resto se già pagato
    const resto = totalePagato - tot;
    document.getElementById("restoDovuto").innerText = resto >= 0 ? resto.toFixed(2) : "0.00";

    const restoB = restoDovutoSpan.parentElement; // prende il <b> genitore
    if (totalePagato > tot) {
        restoB.style.color = "blue"; 
    } else {
        restoB.style.color = "black"; 
    }

    aggiornaStatoInvio();
    aggiornaSuggerimentoResto();
	
}
// --- INPUT E PULSANTE ---
const numInput = document.getElementById("numComanda");
const letteraInput = document.getElementById("letteraComanda");
const inviaBtn = document.getElementById("inviaComandaBtn");
function aggiornaStatoInvio() {
    if (!checkOnline(true)) return;
    const num = numInput.value.trim();
    const lettera = letteraInput.value.trim().toUpperCase();

    // verifica che ci sia almeno un piatto con quantità > 0
    const hasPiattiValidi = comandaCorrente.some(p => p.quantita > 0);

    // disabilita se manca numero, lettera o piatti
    inviaBtn.disabled = !(num && lettera && /^[A-Z]$/.test(lettera) && hasPiattiValidi);

    // Aggiorna stile visivo
    if (inviaBtn.disabled) {
        inviaBtn.style.opacity = 0.5;
        inviaBtn.style.cursor = "not-allowed";
        inviaBtn.style.backgroundColor = "#ccc";
        inviaBtn.style.border = "1px solid #999";
    } else {
        inviaBtn.style.opacity = 1;
        inviaBtn.style.cursor = "pointer";
        inviaBtn.style.backgroundColor = "#f5f5f5";
        inviaBtn.style.border = "1px solid #aaa";
    }
}
// --- LISTENER INPUT ---
numInput.addEventListener("input", aggiornaStatoInvio);
letteraInput.addEventListener("input", aggiornaStatoInvio);
document.getElementById("quantita").addEventListener("change", aggiornaStatoInvio);
// --- FUNZIONE CALCOLO SCONTO ---
function calcolaPrezzoConSconto(piatto){
    if (!checkOnline(true)) return;
    const q = piatto.quantita || 1;
    if(!piatto.sconto) return piatto.prezzo * q;

    if(piatto.sconto.tipo === "percentuale"){
        return piatto.prezzo * q * (1 - piatto.sconto.valore/100);
    } else if(piatto.sconto.tipo === "x_paga_y"){
        const x = piatto.sconto.valore.x;
        const y = piatto.sconto.valore.y;
        const gruppi = Math.floor(q / x);
        const rimanenti = q % x;
        return (gruppi * y + rimanenti) * piatto.prezzo;
    } else if(piatto.sconto.tipo === "x_paga_y_fisso"){ 
        const x = piatto.sconto.valore.x;  // numero di articoli per gruppo
        const y = piatto.sconto.valore.y;  // prezzo totale del gruppo in €
        const gruppi = Math.floor(q / x);
        const rimanenti = q % x;
        return gruppi * y + rimanenti * piatto.prezzo;
    }
    return piatto.prezzo * q;
}

// -------------------- SOLDI --------------------
const soldi = [
    { val: 50, img: "img/banconota50.png" },
    { val: 20, img: "img/banconota20.png" },
    { val: 10, img: "img/banconota10.png" },
    { val: 5, img: "img/banconota5.png" },
    { val: 2, img: "img/moneta2.png" },
    { val: 1, img: "img/moneta1.png" },
    { val: 0.5, img: "img/moneta05.png" },
    { val: 0.2, img: "img/moneta02.png" },
    { val: 0.1, img: "img/moneta01.png" }
];
let totalePagato = 0;
const totalePagatoSpan = document.getElementById("totalePagato");
const restoDovutoSpan = document.getElementById("restoDovuto");
const banconoteDiv = document.getElementById("banconoteDiv");
const moneteDiv = document.getElementById("moneteDiv");
soldi.forEach(s => {
    const btn = document.createElement("button");
    btn.style.border = "none";
    btn.style.padding = "0";
    btn.style.background = "transparent";
    btn.style.touchAction = "manipulation"; // migliora risposta su touch
    btn.style.userSelect = "none";
    btn.style.webkitTapHighlightColor = "transparent";

    const img = document.createElement("img");
    img.src = s.img;
    img.alt = s.val + "€";
    img.style.pointerEvents = "none"; // 🔹 evita che l'immagine blocchi il tocco

    if (s.val >= 5) { // banconote
        img.style.width = "70px";
        img.style.height = "45px";
        btn.appendChild(img);
        banconoteDiv.appendChild(btn);
    } else { // monete
        img.style.width = "50px";
        img.style.height = "50px";
        btn.appendChild(img);
        moneteDiv.appendChild(btn);
    }

    // 🔹 sostituisce onclick con pointerdown: più rapido e affidabile
    btn.addEventListener("pointerdown", (e) => {
        e.preventDefault(); // evita doppio tocco o zoom su mobile

        // Aggiorna importo pagato con arrotondamento sicuro
        totalePagato = Number((totalePagato + Number(s.val)).toFixed(2));
        document.getElementById("totalePagato").innerText = totalePagato.toFixed(2);

        // Calcola resto
        const totale = parseFloat(document.getElementById("totale").innerText) || 0;
        const resto = Math.round((totalePagato - totale) * 100) / 100;
        restoDovutoSpan.innerText = resto >= 0 ? resto.toFixed(2) : "0.00";

        // Aggiorna suggerimenti di resto
        aggiornaSuggerimentoResto();

        // Cambia colore testo a seconda dello stato
        if (totalePagato > totale) {
            restoDovutoSpan.parentElement.style.color = "blue";
        } else {
            restoDovutoSpan.parentElement.style.color = "black";
        }

        // Piccolo feedback visivo
        btn.classList.add("pressed");
        setTimeout(() => btn.classList.remove("pressed"), 100);
    }, { passive: false });
});
document.getElementById("resetSoldiBtn").onclick = () => {
    totalePagato = 0;
    document.getElementById("totalePagato").innerText = "0.00";
    const totale = parseFloat(document.getElementById("totale").innerText) || 0;
    restoDovutoSpan.innerText = "0.00";
    aggiornaSuggerimentoResto();
    restoDovutoSpan.parentElement.style.color = "black";
};
function calcolaRestoMinimo(resto) {
    if (!checkOnline(true)) return;
    const soldiOrdinati = [...soldi].sort((a,b) => b.val - a.val); // dal più grande al più piccolo
    const restoSuggerito = [];

    let r = Math.round(resto * 100) / 100; // evita problemi decimali

    for (const s of soldiOrdinati) {
        let qty = Math.floor(r / s.val);
        if (qty > 0) {
            restoSuggerito.push({val: s.val, quantita: qty});
            r -= qty * s.val;
            r = Math.round(r * 100) / 100; // correzione decimali
        }
    }

    return restoSuggerito;
}
function aggiornaSuggerimentoResto() {
    if (!checkOnline(true)) return;
    const totale = parseFloat(document.getElementById("totale").innerText) || 0;
    const resto = totalePagato - totale;
    const divSuggerimento = document.getElementById("suggerimentoResto");

    const stickyLeft = document.querySelector(".stickyLeft");   // container del Totale/Pagato
    const stickyRight = document.querySelector(".stickyRight"); // container banconote reali

    // calcola posizione a destra del Totale/Pagato
    const stickyLeftRect = stickyLeft.getBoundingClientRect();
    divSuggerimento.style.left = (stickyLeftRect.right + 5) + "px";

    // calcola spazio disponibile fino al container delle banconote
    const stickyRightRect = stickyRight.getBoundingClientRect();
    const availableWidth = stickyRightRect.left - stickyLeftRect.right - 10; // margine 10px
    divSuggerimento.style.maxWidth = availableWidth + "px";

    // svuota il contenuto precedente
    divSuggerimento.innerHTML = "";

    if (resto > 0) {
        const restoMinimo = calcolaRestoMinimo(resto);
        if (restoMinimo.length === 0) return;

        // parentesi iniziale
        const open = document.createElement("span");
        open.innerText = "(";
        divSuggerimento.appendChild(open);

        restoMinimo.forEach(r => {
            const s = soldi.find(s => s.val === r.val);
            if (!s) return;

            const span = document.createElement("span");
            span.style.display = "inline-flex";
            span.style.alignItems = "center";
            span.style.marginRight = "5px";

            const qtyText = document.createElement("span");
            qtyText.innerText = `${r.quantita}x `;
            qtyText.style.marginRight = "3px";

            const img = document.createElement("img");
            img.src = s.img;
            img.alt = `${s.val}€`;
            img.style.width = s.val >= 5 ? "60px" : "40px";
            img.style.height = "auto";

            span.appendChild(qtyText);
            span.appendChild(img);
            divSuggerimento.appendChild(span);
        });

        // parentesi finale
        const close = document.createElement("span");
        close.innerText = ")";
        divSuggerimento.appendChild(close);
    }
}
// Comande in realtime per cassa
function caricaComandeCassa() {
    if (!checkOnline(true)) return;
  const div = document.getElementById("comandeCassa");
  showLoader(); // 🔹 mostra la rotellina all'inizio

  // Listener realtime
  db.ref("comande").on("value", snap => {
    calcolaEVisualizzaTempoMedio(snap);
    const ordiniIds = new Set();

    // Se non ci sono comande
    if (!snap.exists()) {
      div.innerHTML = "<i>Nessuna comanda presente</i>";
      document.getElementById("conteggioComande").innerText = 0;
      hideLoader(); // ✅ nasconde comunque la rotellina
      return;
    }

    snap.forEach(s => {
      const c = s.val();
      const id = s.key;
      ordiniIds.add(id);

      const { cibo, bere, snack } = separaComanda(c.piatti || []);
      const piattiCibo = cibo.map(i => i.quantita + " " + i.nome).join(" | ") || "—";
      const piattiBere = bere.map(i => i.quantita + " " + i.nome).join(" | ") || "—";
      const piattiSnack = snack.map(i => i.quantita + " " + i.nome).join(" | ") || "—";

      let d = document.getElementById("cassa_comanda_" + id);

      const coloreCibo =
        c.statoCucina === "completato" ? "green" :
        c.statoCucina === "in elaborazione" ? "orange" :
        "red";

      const coloreBere =
        c.statoBere === "completato" ? "green" :
        c.statoBere === "in elaborazione" ? "orange" :
        "red";

    const nuovoHtml = `
        <div style="margin-bottom:5px;">
            <div style="margin-bottom:4px;"><b>Comanda #${c.numero}</b></div>
            <div style="margin-bottom:2px; margin-left:20px;">Piatti: ${piattiCibo}</div>
            <div style="margin-bottom:2px; margin-left:20px;">Bevande: ${piattiBere}</div>
            ${window.settings.snackAbilitato ? `<div style="margin-bottom:2px; margin-left:20px;">Snack: ${piattiSnack}</div>` : ''}
            ${c.note ? `<div style="margin-left:20px; font-style:italic; color:#555;">Note: ${c.note}</div>` : ""}


            <div>
                Stato Cibo: <span style="color:${coloreCibo}; font-weight:bold;">${c.statoCucina}</span> |
                Stato Bere: <span style="color:${coloreBere}; font-weight:bold;">${c.statoBere}</span>
                ${window.settings.snackAbilitato && c.statoSnack !== undefined ? `| Stato Snack: <span style="color:${
                    c.statoSnack === "completato" ? "green" :
                    c.statoSnack === "in elaborazione" ? "orange" : "red"
                }; font-weight:bold;">${c.statoSnack}</span>` : ""}

            </div>

        </div>`;


        if (!d) {
            // nuova comanda → creo il div e lo metto in alto
            d = document.createElement("div");
            d.id = "cassa_comanda_" + id;
            d.className = "order";
            // qui aggiungi l'attributo per la ricerca
            d.dataset.numero = (c.numero + (c.lettera || "")).toUpperCase(); // es: "12A"
            div.prepend(d);
        } else {
            // aggiorno il dataset anche se il div esiste già
            d.dataset.numero = (c.numero + (c.lettera || "")).toUpperCase();
        }
        // aggiorno contenuto
        d.innerHTML = nuovoHtml;

        const colorePagamento = c.metodoPagamento === "pos" ? "blue" : "green";
        d.style.borderLeft = `4px solid ${colorePagamento}`;

        // 🔸 Mostra commento ASPORTO se presente (a capo sopra la lista dei piatti)
        if (c.commento) {
            const asportoDiv = document.createElement("div");
            asportoDiv.className = "asportoLabel";
            asportoDiv.innerText = c.commento;
            asportoDiv.style.margin = "6px 0 6px 1.5cm"; // piccolo rientro come le note
            d.appendChild(asportoDiv);
        }

        // --- Mostra metodo pagamento ---
        if (c.metodoPagamento) {
        const mpDiv = document.createElement("div");
        mpDiv.innerHTML = `<b>Pagamento:</b> ${c.metodoPagamento}`;
        mpDiv.style.marginTop = "2px";
        mpDiv.style.fontStyle = "italic";
        mpDiv.style.color = "#333";
        d.appendChild(mpDiv);
        }

        // --- Mostra orario invio ---
        const timeDiv = document.createElement("div");
        timeDiv.className = "orderTime";
        timeDiv.textContent = `🕒 Inviata alle ${c.orario || "—"}`;
        d.appendChild(timeDiv);

        // evidenziazione/blink per nuove
        if (c.statoCucina === "da fare" || c.statoBere === "da fare") {
            d.classList.add("newOrder", "blink");
            setTimeout(() => d.classList.remove("blink"), 3000);
        } else {
            d.classList.remove("newOrder", "blink");
        }
        });

        // Rimuovo comande eliminate
        Array.from(div.children).forEach(child => {
        const cid = child.id.replace("cassa_comanda_", "");
        if (!ordiniIds.has(cid)) div.removeChild(child);
        });

        // Aggiorna conteggio
        document.getElementById("conteggioComande").innerText = ordiniIds.size;

        hideLoader(); // 🔹 nasconde la rotellina solo dopo che le comande sono costruite
    }, err => {
        console.error("Errore caricamento comande:", err);
        hideLoader(); // 🔹 chiudi anche in caso di errore
    });
    initRicercaComande("comandeCassa", "cercaComandaCassa");
}
// ------------------ ADMIN -----------------
//INGREDIENTI
async function caricaIngredienti() {
    if (!checkOnline(true)) return;
  const container = document.getElementById("ingredientiDiv");
  if (!container) {
    console.error("ingredientiDiv non trovato");
    return;
  }
  container.innerHTML = "Caricamento ingredienti...";

  try {
    const snap = await db.ref("ingredienti").once("value");
    const data = snap.val() || {};
    // 🔹 Controllo automatico: blocca/sblocca piatti in base agli ingredienti
    for (const ingId in data) {
        const ing = data[ingId];
        if (!ing) continue;

        // Controlla se l'ingrediente è finito
        const finito = (ing.disponibile === false || (ing.rimanente !== null && ing.rimanente <= 0));

        // Ottieni tutti i piatti
        const snapMenu = await db.ref("menu").once("value");
        const menuData = snapMenu.val() || {};

        for (const [pid, piatto] of Object.entries(menuData)) {
            if (!piatto.ingredienti) continue;

            // Verifica se il piatto usa questo ingrediente
            const usa = piatto.ingredienti.some(i => i.id === ingId);
            if (!usa) continue;

            // Se l’ingrediente è finito → attiva bloccoIngredienti
            if (finito) {
                if (piatto.bloccoIngredienti !== true) {
                    await db.ref(`menu/${pid}/bloccoIngredienti`).set(true);
                }
            } else {
                // Ingrediente disponibile → togli solo il blocco automatico
                if (piatto.bloccoIngredienti === true) {
                    await db.ref(`menu/${pid}/bloccoIngredienti`).set(false);
                }
            }
        }
    }
    ingredientData = data; 
    container.innerHTML = "";
    if (Object.keys(data).length === 0) {
      container.innerHTML = "<i>Nessun ingrediente presente</i>";
      return;
    }

    const fragment = document.createDocumentFragment();
    const categorie = {};

    // Raggruppa per categoria
    for (const [id, ing] of Object.entries(data)) {
      const cat = ing.categoria || "Altro";
      if (!categorie[cat]) categorie[cat] = [];
      categorie[cat].push({ id, ...ing });
    }

    for (const [cat, items] of Object.entries(categorie)) {
      const catDiv = document.createElement("div");
      const h3 = document.createElement("h3");
      h3.innerText = cat.charAt(0).toUpperCase() + cat.slice(1);
      catDiv.appendChild(h3);

      items.forEach(ing => {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.gap = "8px";
        row.style.marginBottom = "6px";

        const nameSpan = document.createElement("span");
        nameSpan.innerText = ing.nome;
        nameSpan.style.flex = "1";

        const qtyInput = document.createElement("input");
        qtyInput.type = "number";
        qtyInput.min = 0;
        abilitaIncrementoDinamico(qtyInput);
        qtyInput.value = (ing.rimanente === null || typeof ing.rimanente === "undefined") ? "" : ing.rimanente;
        qtyInput.style.width = "70px";
        qtyInput.step = "any";

        const statoSpan = document.createElement("span");
        statoSpan.style.fontWeight = "bold";
        const isEsaurito = (ing.rimanente === 0);
        statoSpan.style.color = isEsaurito ? "red" : "green";
        statoSpan.innerText = isEsaurito ? "Esaurito" : "Disponibile";

        const btnDisp = document.createElement("button");
        btnDisp.innerText = "Disponibile";
        btnDisp.onclick = async () => {
          await db.ref(`ingredienti/${ing.id}`).update({ rimanente: null, disponibile: true });
          await caricaIngredienti();
        };

        const btnEs = document.createElement("button");
        btnEs.innerText = "Esaurito";
        btnEs.onclick = async () => {
          await db.ref(`ingredienti/${ing.id}`).update({ rimanente: 0, disponibile: false });
            await caricaIngredienti();
        };

        const btnElimina = document.createElement("button");
        btnElimina.innerText = "Elimina";
        btnElimina.className = "delete";
        btnElimina.onclick = () => {
            question(`Eliminare "${ing.nome}"?`, {
                confirmText: "Conferma",
                cancelText: "Annulla",
                onConfirm: async () => {
                    await db.ref(`ingredienti/${ing.id}`).remove();
                    const snapMenu = await db.ref("menu").once("value");
                    const menuData = snapMenu.val() || {};
                    for (const [pid, piatto] of Object.entries(menuData)) {
                        if (piatto.ingredienti) {
                            const nuoviIng = piatto.ingredienti.filter(x => x.id !== ing.id);
                            if (nuoviIng.length !== piatto.ingredienti.length) {
                                await db.ref(`menu/${pid}/ingredienti`).set(nuoviIng);
                            }
                        }
                    }
                    await caricaIngredienti();
                },
                onCancel: () => {}
            });
        };

        qtyInput.onchange = async (e) => {
        let newQty = e.target.value === "" ? null : parseFloat(e.target.value);
          if (newQty !== null && (isNaN(newQty) || newQty < 0)) newQty = 0;
          await db.ref(`ingredienti/${ing.id}`).update({
            rimanente: newQty,
            disponibile: newQty === null ? true : (newQty > 0)
          });
        await caricaIngredienti();
        };
        // NUOVO SELECT UNITÀ
        const selectUnita = document.createElement("select");
        ["pz", "kg", "l"].forEach(u => {
            const opt = document.createElement("option");
            opt.value = u;
            opt.innerText = u;
            if(ing.unita === u) opt.selected = true; // seleziona l'unità corrente
            selectUnita.appendChild(opt);
        });
        selectUnita.onchange = async () => {
            await db.ref(`ingredienti/${ing.id}`).update({ unita: selectUnita.value });
        };
        row.appendChild(nameSpan);
        row.appendChild(qtyInput);
        row.appendChild(selectUnita);
        row.appendChild(statoSpan);
        row.appendChild(btnDisp);
        row.appendChild(btnEs);
        row.appendChild(btnElimina);
        catDiv.appendChild(row);
        const hr = document.createElement("hr");
        hr.style.margin = "4px 0";
        catDiv.appendChild(hr);
      });

      fragment.appendChild(catDiv);
    }

    container.appendChild(fragment);
  } catch (err) {
    console.error("Errore caricaIngredienti:", err);
    container.innerHTML = "<i>Errore caricamento ingredienti (vedi console)</i>";
  } 
}
function aggiornaStatoIngredient(id) {
    const span = document.getElementById(`stato_${id}`);
    if(!span) return;
    const rimanente = ingredientData[id]?.rimanente || 0;
    span.innerText = rimanente > 0 ? "Disponibile" : "Esaurito";
    span.style.color = rimanente > 0 ? "green" : "red";
}
function renderIngredientOptionsForCategory(cat, container) {
  container.innerHTML = "";
  const items = Object.keys(ingredientData || {})
    .filter(k => (ingredientData[k].categoria || 'cibi') === cat)
    .map(k => ({ id: k, ...ingredientData[k] }));

  if (items.length === 0) {
    container.innerHTML = "<div style='font-style:italic;'>Nessun ingrediente per questa categoria</div>";
    return;
  }

  items.forEach(it => {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "8px";
    row.style.marginBottom = "6px";

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.dataset.ingredId = it.id;
    if (window.selectedMap && window.selectedMap[it.id]) chk.checked = true;

    const label = document.createElement("label");
    label.style.flex = "1";
    const rText = (it.rimanente === null || typeof it.rimanente === "undefined") ? "illimitato" : it.rimanente;
    const unitaTxt = it.unita ? it.unita : "pz";
    label.innerText = `${it.nome} (${rText !== "illimitato" ? rText + " " + unitaTxt : "illimitato"}) ${it.disponibile === false ? '(esaurito)' : ''}`;


    const qty = document.createElement("input");
    qty.type = "number";
    qty.min = 1;
    qty.value = (window.selectedMap && window.selectedMap[it.id]) ? window.selectedMap[it.id] : 1;
    qty.style.width = "70px";
    abilitaIncrementoDinamico(qty);

    // aggiorna mappa quando cambia checkbox o qty
    chk.addEventListener("change", () => {
        if (chk.checked) window.selectedMap[it.id] = parseInt(qty.value) || 1;
        else delete window.selectedMap[it.id];
    });
    qty.addEventListener("input", () => {
        if (chk.checked) window.selectedMap[it.id] = parseInt(qty.value) || 1;
    });

    if (it.disponibile === false) { chk.disabled = true; qty.disabled = true; }

    row.appendChild(chk);
    row.appendChild(label);
    const unitaLabel = document.createElement("span");
    unitaLabel.innerText = ` quantità (${it.unita || "pz"}): `;
    row.appendChild(unitaLabel);

    row.appendChild(qty);

    container.appendChild(row);
  });
}
function aggiornaOpzioniIngredientiMenu(){
    if (!checkOnline(true)) return;
    const container = document.getElementById("piattoIngredientiContainer");
    const cat = document.getElementById("piattoCat").value;
    renderIngredientOptionsForCategory(cat, container, null);
}
//aggiungi ingrediente
document.getElementById("aggiungiIngredienteBtn").onclick = async () => {
    const nome = document.getElementById("ingredienteNome").value.trim();
    const categoria = document.getElementById("ingredienteCategoria").value;
    const rimanenteVal = document.getElementById("ingredienteRimanente").value;

    // se vuoto, la quantità sarà illimitata (null)
    const rimanente = rimanenteVal === "" ? null : parseInt(rimanenteVal);

    if(!nome){ 
        notify("Inserisci il nome dell'ingrediente", "warn"); 
        return; 
    }
    const unita = document.getElementById("ingredienteUnita").value || "pz";
    // evita duplicati nella stessa categoria
    const snap = await db.ref("ingredienti").orderByChild("nome").equalTo(nome).once("value");
    if(snap.exists()){
        const found = Object.entries(snap.val()).find(([k,v]) => (v.categoria||'') === categoria);
        if(found){
            const key = found[0];
            await db.ref("ingredienti/" + key).update({ 
                rimanente, 
                disponibile: rimanente === null || rimanente > 0, 
                categoria,
                unita
            });
            document.getElementById("ingredienteNome").value = "";
            document.getElementById("ingredienteRimanente").value = "";
            caricaIngredienti();
            return;
        }
    }

    // inserimento nuovo
    await db.ref("ingredienti").push({ 
        nome, 
        categoria, 
        rimanente,
        unita: unita,
        disponibile: true  // di default disponibile
    });

    document.getElementById("ingredienteNome").value = "";
    document.getElementById("ingredienteRimanente").value = "";
    caricaIngredienti();
};
function initIngredientiAdminRealtime() {
    if (!checkOnline(true)) return;
    const container = document.getElementById("ingredientiDiv");
    if (!container) return;

    // 🔹 registra listener una sola volta
    if (!window.ingredientiRealtimeAttivo) {
        db.ref("ingredienti").on("value", snap => {
            const data = snap.val() || {};
            ingredientData = data;
            caricaIngredienti();  // renderizza ingredienti aggiornati
        });
        window.ingredientiRealtimeAttivo = true;
    }
}
// GESTIONE comande admin
async function caricaGestioneComandeAdmin() {
    if (!checkOnline(true)) return;
    showLoader();
    const statiCibo = ["da fare", "in elaborazione", "completato"];
    const statiBere = ["da fare", "in elaborazione", "completato"];
    const listaDiv = document.getElementById("listaComandeAdmin");
    db.ref("comande").off(); // pulizia totale
    db.ref("comande").on("value", async snap => {
        calcolaEVisualizzaTempoMedio(snap);
        listaDiv.innerHTML = "";
        let ordiniCount = 0;
        // 🔹 Leggi una sola volta se lo snack è abilitato
        let snackAbilitato = false;
        try {
            const snapSnack = await db.ref("impostazioni/snackAbilitato").once("value");
            snackAbilitato = snapSnack.exists() && snapSnack.val() === true;
        } catch (err) {
            console.warn("Errore lettura impostazione snackAbilitato:", err);
        }

        if (!snap.exists() || snap.numChildren() === 0) {
            listaDiv.innerHTML = "<i>Nessuna comanda presente</i>";
            document.getElementById("conteggioComandeAdmin").innerText = 0;
            return;
        }


        snap.forEach(s => {
            const c = s.val(); 
            const id = s.key;

            const { cibo, bere, snack } = separaComanda(c.piatti || []);
            // 🔹 Evita loop: aggiorna solo localmente, non scrivere subito su Firebase
            if ((!snack || snack.length === 0) && c.statoSnack !== "completato") {
                c.statoSnack = "completato"; // solo lato front-end
                // aggiornamento remoto differito, senza trigger immediato del listener
                setTimeout(() => {
                    db.ref("comande/" + id).update({ statoSnack: "completato" }).catch(err => console.warn(err));
                }, 0);
            }
           
            const piattiCibo = cibo.map(i => i.quantita + "x " + i.nome).join(" | ") || "—";
            const piattiBere = bere.map(i => i.quantita + "x " + i.nome).join(" | ") || "—";
            const piattiSnack = snack && snack.length ? snack.map(i => i.quantita + "x " + i.nome).join(" | ") : null;

            const riga = document.createElement("div");
            riga.className = "order";
            riga.id = "admin_comanda_" + id;
            // aggiungi dataset per la ricerca
            riga.dataset.numero = (c.numero + (c.lettera || "")).toUpperCase();

            // Header numero + piatti
            const mainDiv = document.createElement("div");
            mainDiv.style.display = "flex";
            mainDiv.style.justifyContent = "space-between";
            mainDiv.style.alignItems = "flex-start";
            mainDiv.style.gap = "20px";

            const numDiv = document.createElement("div");
            numDiv.innerHTML = `<b>#${c.numero}</b>`;
            mainDiv.appendChild(numDiv);
            riga.appendChild(mainDiv);

            // 🔸 Mostra commento ASPORTO se presente (fuori dal flex, va a capo)
            if (c.commento) {
                const asportoDiv = document.createElement("div");
                asportoDiv.className = "asportoLabel";
                asportoDiv.innerText = c.commento;
                asportoDiv.style.margin = "4px 0 6px 0.8cm";
                riga.appendChild(asportoDiv);
            }

            const piattiDiv = document.createElement("div");
            piattiDiv.className = "orderContent";

            // 🔹 Mostra sempre lo snack, anche se vuoto (ma solo se abilitato)
            piattiDiv.innerHTML = `
                <div>Piatti: ${piattiCibo}</div>
                <div>Bevande: ${piattiBere}</div>
                ${snackAbilitato ? `<div>Snack: ${piattiSnack || "—"}</div>` : ""}
            `;


            mainDiv.appendChild(piattiDiv);
            // se ci sono note, aggiungile
            if (c.note) {
                const noteDiv = document.createElement("div");
                noteDiv.innerHTML = `<i>Note: ${c.note}</i>`;
                noteDiv.style.color = "#555";
                noteDiv.style.marginTop = "4px";
                piattiDiv.appendChild(noteDiv);
            }
            riga.appendChild(mainDiv);

            // Pulsanti + stato
            const buttonsDiv = document.createElement("div");
            buttonsDiv.className = "orderButtons";
            buttonsDiv.style.display = "flex";
            buttonsDiv.style.justifyContent = "flex-end";
            buttonsDiv.style.gap = "6px";
            buttonsDiv.style.marginTop = "5px";

            const statoDiv = document.createElement("div");
            statoDiv.style.marginTop = "5px";

            // --- Pulsante toggle Cibo a 3 stati ---
            const btnSegnaCibo = document.createElement("button");
            aggiornaBtn(btnSegnaCibo, "cibo", c.statoCucina);
            btnSegnaCibo.onclick = async () => {
                let nuovo;
                if(c.statoCucina === "da fare") nuovo = "in elaborazione";
                else if(c.statoCucina === "in elaborazione") nuovo = "completato";
                else if(c.statoCucina === "completato") nuovo = "da fare";
                await db.ref("comande/" + id).update({ statoCucina: nuovo });
            };

            // --- Pulsante toggle Bere a 3 stati ---
            const btnSegnaBere = document.createElement("button");
            aggiornaBtn(btnSegnaBere, "bere", c.statoBere);
            btnSegnaBere.onclick = async () => {
                let nuovo;
                if(c.statoBere === "da fare") nuovo = "in elaborazione";
                else if(c.statoBere === "in elaborazione") nuovo = "completato";
                else if(c.statoBere === "completato") nuovo = "da fare";
                await db.ref("comande/" + id).update({ statoBere: nuovo });
            };

            // Pulsante Modifica
            const btnModifica = document.createElement("button");
            btnModifica.innerText = "Modifica";
            btnModifica.onclick = () => modificaComanda(id, c);

            // Pulsante Elimina
            const btnElimina = document.createElement("button");
            btnElimina.innerText = "Elimina";
            btnElimina.className = "delete";
            btnElimina.onclick = () => {
                question("Sei sicuro di voler eliminare questa comanda?", {
                    confirmText: "Conferma",
                    cancelText: "Annulla",
                    onConfirm: async () => {
                        try {
                            for (const p of c.piatti || []) {
                                for (const i of (p.ingredienti || [])) {
                                    const qty = (i.qtyPerUnit || 1) * (p.quantita || 1);
                                    if (i.id) await applicaIncrementoSingolo(i.id, qty);
                                    else {
                                        const nameLow = (i.nome||"").trim().toLowerCase();
                                        const mapped = Object.keys(ingredientData).find(k => (ingredientData[k].nome||"").trim().toLowerCase() === nameLow);
                                        if (mapped) await applicaIncrementoSingolo(mapped, qty);
                                    }
                                }
                            }
                            await db.ref("comande/"+id).remove();
                            const riga = document.getElementById("admin_comanda_" + id);
                            if (riga && riga.parentNode) riga.parentNode.removeChild(riga);
                            console.log("Comanda eliminata e ingredienti ripristinati.");
                        } catch(err) {
                            console.error("Errore eliminazione comanda:", err);
                            notify("Errore eliminazione comanda: " + err.message, "error");
                        }
                    }
                });
            };
            buttonsDiv.insertBefore(statoDiv, buttonsDiv.firstChild);
            // Funzione helper per stato sopra bottone
            function creaBtnConStato(statoAttuale, tipo, idComanda) {
                const container = document.createElement("div");
                container.className = "btnStatoContainer";  // nuovo stile CSS

                const statoSpan = document.createElement("div");
                statoSpan.innerHTML = `<b>Stato ${tipo.charAt(0).toUpperCase()+tipo.slice(1)}:</b> ${statoAttuale}`;
                statoSpan.style.fontWeight = "bold";
                statoSpan.style.fontSize = "0.9em";
                statoSpan.style.color = (statoAttuale === "completato") ? "green" :
                                        (statoAttuale === "in elaborazione") ? "orange" : "red";

                const btn = document.createElement("button");
                aggiornaBtn(btn, tipo, statoAttuale);
                btn.onclick = async () => {
                    let nuovo;
                    if (statoAttuale === "da fare") nuovo = "in elaborazione";
                    else if (statoAttuale === "in elaborazione") nuovo = "completato";
                    else nuovo = "da fare";
                    const chiave = "stato" + tipo.charAt(0).toUpperCase() + tipo.slice(1);
                    await aggiornaStatoConTermine(idComanda, chiave, nuovo);
                };

                container.appendChild(statoSpan);
                container.appendChild(btn);
                return container;
            }

            // Uso:
            buttonsDiv.appendChild(creaBtnConStato(c.statoCucina, "cucina", id));
            buttonsDiv.appendChild(creaBtnConStato(c.statoBere, "bere", id));

            // 🔹 Mostra sempre il tasto Snack se impostazione attiva (anche se la comanda non ha snack)
            if (snackAbilitato) {
                buttonsDiv.appendChild(creaBtnConStato(c.statoSnack || "completato", "snack", id));
            }



            buttonsDiv.appendChild(btnModifica);
            buttonsDiv.appendChild(btnElimina);

            riga.appendChild(buttonsDiv);

            // --- Mostra metodo pagamento ---
            if (c.metodoPagamento) {
            const mpDiv = document.createElement("div");
            mpDiv.innerHTML = `<b>Pagamento:</b> ${c.metodoPagamento}`;
            mpDiv.style.marginTop = "2px";
            mpDiv.style.fontStyle = "italic";
            mpDiv.style.color = "#333";
            riga.appendChild(mpDiv);
            }

            // --- Mostra orario invio ---
            const timeDiv = document.createElement("div");
            timeDiv.className = "orderTime";
            timeDiv.textContent = `🕒 Inviata alle ${c.orario || "—"}`;
            riga.appendChild(timeDiv);



            // Lampeggio nuova comanda
            if(c.statoCucina==="da fare" || c.statoBere==="da fare"){
                riga.classList.add("newOrder");
                riga.classList.add("blink");
                setTimeout(()=>riga.classList.remove("blink"),3000);
            } else {
                riga.classList.remove("newOrder");
                riga.classList.remove("blink");
            }

            listaDiv.prepend(riga);
            ordiniCount++;
        });
        document.getElementById("conteggioComandeAdmin").innerText = ordiniCount;
    });

    // Helper per aggiornare testo e colore del pulsante in base allo stato
    function aggiornaBtn(btn, tipo, stato) {
        let testo = "", colore = "";
        if (stato === "da fare") { 
            testo = "Segna in elaborazione"; 
            colore = "orange"; 
        }
        else if (stato === "in elaborazione") { 
            testo = "Segna completato"; 
            colore = "green"; 
        }
        else if (stato === "completato") { 
            testo = "Segna da fare"; 
            colore = "red"; 
        }
        btn.innerText = testo;
        btn.style.background = colore;
        btn.style.color = "white";
    }
    initRicercaComande("listaComandeAdmin", "cercaComandaAdmin");
    hideLoader();
}
function modificaComanda(id, comanda) {
    if (!checkOnline(true)) return;
    const tab = document.getElementById("comandeTab");

    // se c'è già un pannello di modifica per questo id, scrolla lì
    const existingEdit = tab.querySelector("#admin_edit_comanda_" + id);
    if (existingEdit) {
        existingEdit.scrollIntoView({ behavior: "smooth" });
        return;
    }

    const divAdmin = document.createElement("div");
    divAdmin.style.border = "1px solid #ccc";
    divAdmin.style.padding = "10px";
    divAdmin.style.margin = "5px";
    divAdmin.style.backgroundColor = "#f9f9f9";
    divAdmin.id = "admin_edit_comanda_" + id;

    // copia locale della comanda (modifiche rimangono locali finché non salvi)
    let comandaTemp = JSON.parse(JSON.stringify(comanda));

    // MAP per tenere traccia di quanto abbiamo già riservato su DB durante la modifica
    // reserved: { ingredienteId: qtyRiservata }
    const reserved = {}; // inizialmente vuoto

    // utilità per accumulare in reserved
    function addReserved(id, qty) { reserved[id] = (reserved[id] || 0) + qty; }
    function subReserved(id, qty) { reserved[id] = Math.max(0, (reserved[id] || 0) - qty); }

    // HEADER
    const header = document.createElement("h4");
    header.innerText = `Modifica Comanda #${comanda.numero}`;
    divAdmin.appendChild(header);

    // LISTA PIATTI + TOTALE
    const listaPiatti = document.createElement("div");
    divAdmin.appendChild(listaPiatti);
    const totDiv = document.createElement("div");
    divAdmin.appendChild(totDiv);

    const aggiornaLista = () => {
        listaPiatti.innerHTML = "";
        let totale = 0;
        const piatti = comandaTemp.piatti || [];

        piatti.forEach((p, idx) => {
            const r = document.createElement("div");
            r.style.display = "flex";
            r.style.justifyContent = "space-between";
            r.style.alignItems = "center";
            r.style.marginBottom = "6px";

            const info = document.createElement("span");
            // mostro anche eventuali ingredienti del piatto (se presenti)
            let infoText;
            if (p.sconto) {
                if (p.sconto.tipo === "percentuale") {
                    infoText = `${p.quantita}x ${p.nome} ` +
                        `<span style="text-decoration: line-through; text-decoration-color:red; text-decoration-thickness: 2px; color:black;">€${p.prezzo.toFixed(2)}</span> ` +
                        `<span style="color:red;">€${calcolaPrezzoConSconto(p).toFixed(2)}</span>`;
                } else if (p.sconto.tipo === "x_paga_y") {
                    infoText = `${p.quantita}x ${p.nome} (€${calcolaPrezzoConSconto(p).toFixed(2)})`;
                } else {
                    infoText = `${p.quantita}x ${p.nome} (€${p.prezzo.toFixed(2)})`;
                }
            } else {
                infoText = `${p.quantita}x ${p.nome} (€${p.prezzo.toFixed(2)})`;
            }
            // Sempre mostra ingredienti se presenti, anche per piatti già aggiunti
            if (p.ingredienti && p.ingredienti.length) {
                const ingTxt = p.ingredienti.map(i => {
                    const nome = i.nome || (ingredientData[i.id]?.nome || "ingrediente sconosciuto");
                    const qty = i.qtyPerUnit ? ` x${i.qtyPerUnit}` : "";
                    return nome + qty;
                }).join(", ");
                infoText += ` — [${ingTxt}]`;
            }

            info.innerHTML = infoText;

            const controls = document.createElement("span");

            const btnMinus = document.createElement("button");
            btnMinus.innerText = "-";
            btnMinus.onclick = async () => {
                if (p.quantita > 1) {
                    // restituisco 1 unità per ingredienti del piatto
                    (p.ingredienti || []).forEach(async i => {
                        const qty = i.qtyPerUnit || 1;
                        if (i.id) { await applicaIncrementoSingolo(i.id, qty); subReserved(i.id, qty); }
                        else {
                            const nameLow = (i.nome||"").trim().toLowerCase();
                            const mapped = Object.keys(ingredientData).find(k => (ingredientData[k].nome||"").trim().toLowerCase() === nameLow);
                            if (mapped) { await applicaIncrementoSingolo(mapped, qty); subReserved(mapped, qty); }
                        }
                    });
                    p.quantita--;
                } else {
                    // p.quantita === 1 -> rimuovo e restituisco tutto
                    (p.ingredienti || []).forEach(async i => {
                        const qty = (i.qtyPerUnit || 1) * 1;
                        if (i.id) { await applicaIncrementoSingolo(i.id, qty); subReserved(i.id, qty); }
                        else {
                            const nameLow = (i.nome||"").trim().toLowerCase();
                            const mapped = Object.keys(ingredientData).find(k => (ingredientData[k].nome||"").trim().toLowerCase() === nameLow);
                            if (mapped) { await applicaIncrementoSingolo(mapped, qty); subReserved(mapped, qty); }
                        }
                    });
                    comandaTemp.piatti.splice(idx, 1);
                }
                aggiornaLista();
            };
            const btnPlus = document.createElement("button");
            btnPlus.innerText = "+";
            btnPlus.style.marginLeft = "6px";
            btnPlus.onclick = async () => {
                const delta = 1;
                const richiesteDelta = calcolaRichiesteDaPiatti([ { ingredienti: p.ingredienti || [], quantita: delta } ]);
                btnPlus.disabled = true;
                const r = await applicaDecrementiIngredienti(richiesteDelta);
                btnPlus.disabled = false;
                if (!r.success) { notify("Non c'è abbastanza disponibilità per aumentare la quantità: " + (r.message||""), "error"); return; }
                p.quantita++;
                (p.ingredienti || []).forEach(i => {
                    if (i.id) addReserved(i.id, i.qtyPerUnit || 1);
                    else {
                        const nameLow = (i.nome||"").trim().toLowerCase();
                        const mapped = Object.keys(ingredientData).find(k => (ingredientData[k].nome||"").trim().toLowerCase() === nameLow);
                        if (mapped) addReserved(mapped, i.qtyPerUnit || 1);
                    }
                });
                aggiornaLista();
            };

            const btnRemove = document.createElement("button");
            btnRemove.innerText = "❌";
            btnRemove.style.marginLeft = "6px";
            btnRemove.onclick = async () => {
                (p.ingredienti || []).forEach(async i => {
                    const qty = (i.qtyPerUnit || 1) * (p.quantita || 1);
                    if (i.id) { await applicaIncrementoSingolo(i.id, qty); subReserved(i.id, qty); }
                    else {
                        const nameLow = (i.nome||"").trim().toLowerCase();
                        const mapped = Object.keys(ingredientData).find(k => (ingredientData[k].nome||"").trim().toLowerCase() === nameLow);
                        if (mapped) { await applicaIncrementoSingolo(mapped, qty); subReserved(mapped, qty); }
                    }
                });
                comandaTemp.piatti.splice(idx, 1);
                aggiornaLista();
            };

            controls.appendChild(btnMinus);
            controls.appendChild(btnPlus);
            controls.appendChild(btnRemove);

            r.appendChild(info);
            r.appendChild(controls);
            listaPiatti.appendChild(r);

            totale += calcolaPrezzoConSconto(p);
        });

        totDiv.innerHTML = `<b>Totale: €${totale.toFixed(2)}</b>`;
    };

    aggiornaLista();

    // --- Aggiungi area per inserire rapidamente piatti dal menu (con verifica ingredienti) ---
    const menuPickDiv = document.createElement("div");
    menuPickDiv.innerHTML = "<h4>Aggiungi dal Menu</h4>";
    const loading = document.createElement("div");
    loading.innerText = "Caricamento menu...";
    menuPickDiv.appendChild(loading);
    divAdmin.appendChild(menuPickDiv);

    // helper: controlla se un menu item è disponibile dati gli ingredienti attuali (ingData)
    function verificaDisponibilitaMenuItem(item, ingData, qtyToAdd = 1) {
        if (!item.ingredienti || !item.ingredienti.length) return { available: true, reason: null };
        for (const req of item.ingredienti) {
            const nomeLow = (req.nome || "").trim().toLowerCase();
            const qtyNeeded = (req.qtyPerUnit || 1) * qtyToAdd;
            const matchKey = Object.keys(ingData).find(k => (ingData[k].nome || "").trim().toLowerCase() === nomeLow);
            if (matchKey) {
                const ing = ingData[matchKey];
                if (ing.disponibile === false) return { available: false, reason: `${ing.nome} non disponibile` };
                if (ing.rimanente !== null && ing.rimanente !== undefined && ing.rimanente < qtyNeeded) {
                    return { available: false, reason: `${ing.nome} quantità insufficiente (${ing.rimanente} < ${qtyNeeded})` };
                }
            }
        }
        return { available: true, reason: null };
    }

    // riferimento al menu e agli ingredienti
    const menuRef = db.ref("menu");
    const ingRef = db.ref("ingredienti");
    const menuButtons = {}; // mappa menuId -> button
    divAdmin._ingredientiListener = null;

    // carico il menu una volta
    menuRef.once("value").then(menuSnap => {
        const menuData = menuSnap.val() || {};

        // ascolto ingredienti in realtime
        const ingListenerFn = ingRef.on("value", ingSnap => {
            const ingData = ingSnap.val() || {};

            if (loading.parentNode) loading.parentNode.removeChild(loading);

            for (const mid in menuData) {
                const mp = menuData[mid];
                if (!mp || !mp.nome) continue;

                let b = menuButtons[mid];
                if (!b) {
                    b = document.createElement("button");
                    b.style.marginRight = "6px";
                    b.style.marginBottom = "6px";
                    // 🔒 Se il piatto è bloccato, disabilitalo subito
                    if (mp.bloccato === true) {
                        b.disabled = true;
                        b.style.opacity = 0.5;
                        b.title = "Piatto bloccato, non ordinabile";
                    }

                    // crea un div interno per gestire prezzo con sconto
                    const prezzoDiv = document.createElement("span");
                    if (mp.sconto) {
                        if (mp.sconto.tipo === "percentuale") {
                            prezzoDiv.innerHTML = `<span style="text-decoration: line-through; text-decoration-color:red; color:black;">€${mp.prezzo.toFixed(2)}</span> <span style="color:red;">€${calcolaPrezzoConSconto(mp).toFixed(2)}</span>`;
                        } else if (mp.sconto.tipo === "x_paga_y") {
                            prezzoDiv.innerText = `€${calcolaPrezzoConSconto(mp).toFixed(2)}`;
                        } else {
                            prezzoDiv.innerText = `€${mp.prezzo.toFixed(2)}`;
                        }
                    } else {
                        prezzoDiv.innerText = `€${mp.prezzo.toFixed(2)}`;
                    }
                    b.innerHTML = `${mp.nome} `;
                    b.appendChild(prezzoDiv);

                    b.onclick = async () => {
                        // 🔒 doppia protezione: se piatto bloccato, non procedere
                        if (mp.bloccato === true) {
                            notify("Questo piatto è bloccato e non può essere aggiunto", "error");
                            return;
                        }
                        const qtyToAdd = 1;

                        const richiesteSingola = { byId: {}, byName: {} };
                        if (mp.ingredienti && mp.ingredienti.length) {
                            mp.ingredienti.forEach(ing => {
                                if (ing.id) richiesteSingola.byId[ing.id] = (richiesteSingola.byId[ing.id] || 0) + ((ing.qtyPerUnit || 1) * qtyToAdd);
                                else if (ing.nome) richiesteSingola.byName[(ing.nome||"").trim().toLowerCase()] = (richiesteSingola.byName[(ing.nome||"").trim().toLowerCase()] || 0) + ((ing.qtyPerUnit || 1) * qtyToAdd);
                            });
                        }

                        b.disabled = true;
                        const decRes = await applicaDecrementiIngredienti(richiesteSingola);
                        b.disabled = false;
                        if (!decRes.success) {
                            notify("Impossibile aggiungere dal menu: " + (decRes.message || "ingredienti"), "error");
                            return;
                        }

                        if (!comandaTemp.piatti) comandaTemp.piatti = [];
                        const esiste = comandaTemp.piatti.find(p => p.nome === mp.nome);
                        if (esiste) { 
                            // aggiungi la quantità e memorizza il prezzo corrente come nuova unità
                            if (!esiste.prezziSingoli) esiste.prezziSingoli = Array(esiste.quantita).fill(esiste.prezzo);
                            esiste.prezziSingoli.push(mp.prezzo);
                            esiste.quantita++;
                            // sconto storico non viene toccato
                        } else {
                            comandaTemp.piatti.push({
                                nome: mp.nome,
                                prezzo: mp.prezzo,
                                quantita: 1,
                                prezziSingoli: [mp.prezzo],
                                categoria: mp.categoria || "altro",
                                sconto: mp.sconto || null,
                                tipo: mp.tipo || (mp.categoria && mp.categoria.toLowerCase().includes("snack") ? "snack" : "cucina"),
                                ingredienti: mp.ingredienti ? JSON.parse(JSON.stringify(mp.ingredienti)) : []
                            });
                        }

                        (mp.ingredienti || []).forEach(i => {
                            if (i.id) addReserved(i.id, i.qtyPerUnit || 1);
                            else {
                                const nameLow = (i.nome||"").trim().toLowerCase();
                                const mapped = Object.keys(ingredientData).find(k => (ingredientData[k].nome||"").trim().toLowerCase() === nameLow);
                                if (mapped) addReserved(mapped, i.qtyPerUnit || 1);
                            }
                        });

                        aggiornaLista();
                    };

                    menuPickDiv.appendChild(b);
                    menuButtons[mid] = b;
                }

                const check = verificaDisponibilitaMenuItem(mp, ingData, 1);
                // 🔒 blocco totale se piatto bloccato
                if (mp.bloccato === true) {
                    b.disabled = true;
                    b.style.opacity = 0.5;
                    b.title = "Piatto bloccato, non ordinabile";
                }
                // 🔧 blocco se ingredienti insufficienti
                else {
                    const check = verificaDisponibilitaMenuItem(mp, ingData, 1);
                    if (!check.available) {
                        b.disabled = true;
                        b.title = check.reason || "Ingrediente non disponibile";
                        b.style.opacity = 0.6;
                    } else {
                        b.disabled = false;
                        b.title = "";
                        b.style.opacity = 1;
                    }
                }

            }
        });

        divAdmin._ingredientiListener = { ref: ingRef, fn: ingListenerFn };
    }).catch(err => {
        if (loading.parentNode) loading.innerText = "Errore caricamento menu";
        console.error("menu load error:", err);
    });


    // --- Pulsanti Salva e Annulla ---
    const azioniDiv = document.createElement("div");
    azioniDiv.style.marginTop = "10px";

    const pulisciListenerIngredienti = () => {
        if (divAdmin && divAdmin._ingredientiListener) {
            try {
                divAdmin._ingredientiListener.ref.off("value", divAdmin._ingredientiListener.fn);
            } catch (e) { /* ignore */ }
            divAdmin._ingredientiListener = null;
        }
    };

    const btnSalva = document.createElement("button");
    btnSalva.innerText = "Salva";
    btnSalva.onclick = async () => {
        try {
            // se la comanda è vuota, la eliminiamo
            if (!comandaTemp.piatti || comandaTemp.piatti.length === 0) {
                await db.ref("comande/" + id).remove();
            } else {
                // le transazioni di decremento sono già state applicate in corso di editing
                const ciboNuovo = comandaTemp.piatti.some(p => p.categoria !== "bevande" && !p.categoria.toLowerCase().includes("snack"));
                const bereNuovo = comandaTemp.piatti.some(p => p.categoria === "bevande");
                const snackNuovo = comandaTemp.piatti.some(p =>
                    (p.categoria && (p.categoria.toLowerCase().includes("snack") || p.categoria.toLowerCase().includes("fritti"))) ||
                    (p.tipo && p.tipo.toLowerCase() === "snack")
                );

                const updateData = {
                    piatti: comandaTemp.piatti,
                    statoCucina: ciboNuovo ? "da fare" : "completato",
                    statoBere: bereNuovo ? "da fare" : "completato"
                };

                // 🔹 Aggiungi statoSnack solo se ci sono snack reali
                if (snackNuovo) {
                    updateData.statoSnack = "da fare";
                } else {
                    updateData.statoSnack = null; // cancellerà o sovrascriverà il campo vuoto
                }

                await db.ref("comande/" + id).update(updateData);

                // 🔹 Se non ci sono snack, rimuovi completamente il campo da Firebase
                if (!snackNuovo) {
                    await db.ref("comande/" + id + "/statoSnack").remove();
                }

            }

            // pannello chiuso (nessun revert necessario)
            const panel = document.getElementById("admin_edit_comanda_" + id);
            if (panel && panel.parentNode) panel.parentNode.removeChild(panel);

            caricaGestioneComandeAdmin();
        } catch(err){
            notify("Errore salvataggio: " + err.message, "error");
        }
    };

    const btnAnnulla = document.createElement("button");
    btnAnnulla.innerText = "Annulla";
    btnAnnulla.style.marginLeft = "10px";
    btnAnnulla.onclick = async () => {
        try {
            if (Object.keys(reserved).length > 0) {
                await applicaIncrementiIngredienti(reserved);
            }
        } catch (e) {
            console.error("Errore revert risorse:", e);
        }

        const panel = document.getElementById("admin_edit_comanda_" + id);
        if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
        caricaGestioneComandeAdmin();
    };


    azioniDiv.appendChild(btnSalva);
    azioniDiv.appendChild(btnAnnulla);
    divAdmin.appendChild(azioniDiv);

    const comandaDiv = document.getElementById("admin_comanda_" + id);
    if (comandaDiv && comandaDiv.parentNode) {
        comandaDiv.insertAdjacentElement("afterend", divAdmin);
    } else {
        tab.appendChild(divAdmin); // fallback
    }

}
// pulsante e cambio categoria
document.getElementById("mostraOpzioniIngredientiBtn").onclick = () => {
    const container = document.getElementById("piattoIngredientiContainer");
    if(container.style.display === "none" || container.style.display === "") {
        container.style.display = "block";
        container.innerHTML = ""; // pulisce prima di aggiornare
        aggiornaOpzioniIngredientiMenu(); // popola la lista
        document.getElementById("mostraOpzioniIngredientiBtn").innerText = "Nascondi ingredienti";
    } else {
        container.style.display = "none";
        document.getElementById("mostraOpzioniIngredientiBtn").innerText = "Mostra ingredienti";
    }
};
document.getElementById("piattoCat").addEventListener("change", () => aggiornaOpzioniIngredientiMenu());

// -------------------- CUCINA E BERE --------------------
async function caricaComandePerRuolo(daFareDiv, storicoDiv, ruolo) {
    if (!checkOnline(true)) return;

    // 🔹 Determina se Snack è attivo
    let snackAbilitato = false;
    try {
        const snapSnack = await db.ref("impostazioni/snackAbilitato").once("value");
        snackAbilitato = snapSnack.exists() && snapSnack.val() === true;
    } catch (err) {
        console.warn("Errore lettura impostazione snackAbilitato:", err);
    }

    // 🔹 Se ruolo è snack ma snack disattivo, fallback su cucina
    let ruoloEffettivo = ruolo;
    if (ruolo === "snack" && !snackAbilitato) ruoloEffettivo = "cucina";

    db.ref("comande").on("value", snap => {
        const tutteComande = snap.val() || {};

        // 🔹 Determina container usando ruoloEffettivo
        const daFareContainer = ruoloEffettivo === "cucina" ? document.getElementById("daFareComandeContainer") :
                                ruoloEffettivo === "bere"   ? document.getElementById("daBereComandeContainer") :
                                document.getElementById("daSnackComandeContainer");
        const storicoContainer = ruoloEffettivo === "cucina" ? document.getElementById("storicoComandeContainer") :
                                ruoloEffettivo === "bere"   ? document.getElementById("storicoBereComandeContainer") :
                                document.getElementById("storicoSnackComandeContainer");


        if (!daFareContainer || !storicoContainer) return;

        daFareContainer.innerHTML = "";
        storicoContainer.innerHTML = "";

        // 🔹 Leggi impostazione nuove in alto
        let nuoveInAlto = true;
        try {
            if (ruolo === "cucina") nuoveInAlto = window.settings.nuoveInAltoCucina;
            else if (ruolo === "bere") nuoveInAlto = window.settings.nuoveInAltoBere;
        } catch(err) { console.warn(err); }

        Object.entries(tutteComande).forEach(([id, c]) => {
            // 🔹 Determina stato
            let statoKey = ruolo === "cucina" ? "statoCucina" :
                           ruolo === "bere" ? "statoBere" :
                           "statoSnack";
            // 🔹 Se la comanda non contiene piatti per questo ruolo, salta
            const { cibo, bere, snack } = separaComanda(c.piatti || []);
            if (ruoloEffettivo === "cucina" && cibo.length === 0) return;
            if (ruoloEffettivo === "bere" && bere.length === 0) return;
            if (ruoloEffettivo === "snack" && snackAbilitato && snack.length === 0) return;

            // 🔹 Separa cibo/bere/snack
            let items;
            if (ruoloEffettivo === "cucina") items = cibo;
            else if (ruoloEffettivo === "bere") items = bere;
            else if (ruoloEffettivo === "snack" && snackAbilitato) {
                items = (c.piatti || []).filter(p => p.categoria === "snack");
                // 🔹 ORDINA ITEMS secondo toggle nuoveInAltoSnack
                if (window.settings.nuoveInAltoSnack) {
                    items.sort((a, b) => b.timestamp - a.timestamp); // nuove in cima
                } else {
                    items.sort((a, b) => a.timestamp - b.timestamp); // nuove in fondo
                }
            }
             else {
                // Snack disattivo → non mostrare nulla in questo ruolo
                return;
            }
            // 🔹 Se cucina e nessun cibo → segna come completata e salta
            if (ruoloEffettivo === "cucina" && items.length === 0 && c[statoKey] !== "completato") {
                db.ref("comande/" + id).update({ [statoKey]: "completato" });
                if (window.tickState && window.tickState[id]) delete window.tickState[id];
                return; // non creare il div in da fare
            }


            // 🔹 Crea div comanda
            const d = document.createElement("div");
            d.className = "order";
            d.id = "ruolo_comanda_" + id + "_" + ruolo;
            d.dataset.numero = (c.numero + (c.lettera || "")).toUpperCase();

            // 🔹 Div principale
            const mainDiv = document.createElement("div");
            mainDiv.style.display = "flex";
            mainDiv.style.gap = "20px";
            mainDiv.style.alignItems = "flex-start";

            const numDiv = document.createElement("div");
            numDiv.innerHTML = `<b>#${c.numero}</b>`;
            mainDiv.appendChild(numDiv);
            d.appendChild(mainDiv);

            // 🔹 Commento asporto
            if (c.commento) {
                const asportoDiv = document.createElement("div");
                asportoDiv.className = "asportoLabel";
                asportoDiv.innerText = c.commento;
                asportoDiv.style.margin = "4px 0 6px 0.8cm";
                d.appendChild(asportoDiv);
            }

            // 🔹 Lista piatti con checkbox
            const listaDiv = document.createElement("div");
            listaDiv.className = "orderContent";
            listaDiv.style.marginLeft = "2cm";

            if(items.length === 0) listaDiv.innerText = "—";
            else items.forEach(i => {
                const p = document.createElement("div");
                p.innerText = `${i.quantita}x ${i.nome}`;

                if ((ruolo === "cucina" || ruolo === "bere" || (ruolo === "snack" && snackAbilitato)) && (c[statoKey] === "da fare" || c[statoKey] === "in elaborazione")) {

                    const box = document.createElement("input");
                    box.type = "checkbox";
                    box.className = "tickItem";
                    const comandaId = id;

                    if (!window.tickState) window.tickState = {};
                    if (!window.tickState[comandaId]) window.tickState[comandaId] = {};

                    const voceKey = `${i.nome}-${i.quantita}`;
                    if (window.tickState[comandaId][voceKey] === undefined) window.tickState[comandaId][voceKey] = false;

                    box.checked = window.tickState[comandaId][voceKey];
                    box.disabled = (c[statoKey] === "da fare");

                    box.addEventListener("change", () => {
                        window.tickState[comandaId][voceKey] = box.checked;
                        const checkboxes = d.querySelectorAll(".tickItem");
                        const tuttiSpuntati = [...checkboxes].every(cb => cb.checked);
                        if (bComp) bComp.disabled = !tuttiSpuntati;
                    });

                    p.prepend(box);
                }

                listaDiv.appendChild(p);
            });
            mainDiv.appendChild(listaDiv);
            d.appendChild(mainDiv);

            // 🔹 Stato + bottoni
            const statoDiv = document.createElement("div");
            statoDiv.style.display = "flex";
            statoDiv.style.alignItems = "center";
            statoDiv.style.justifyContent = "space-between";
            statoDiv.style.marginTop = "5px";

            const statoSpan = document.createElement("span");
            statoSpan.innerText = "Stato: " + c[statoKey];
            statoSpan.style.fontWeight = "bold";
            statoSpan.style.color = (c[statoKey] === "completato") ? "green" :
                                    (c[statoKey] === "in elaborazione") ? "orange" : "red";
            statoDiv.appendChild(statoSpan);

            let bComp = null;

            if(c[statoKey]==="da fare" || c[statoKey]==="in elaborazione") {
                const buttonsDiv = document.createElement("div");
                buttonsDiv.style.display = "flex";
                buttonsDiv.style.gap = "5px";

                if(c[statoKey] === "da fare") {
                    const bElab = document.createElement("button");
                    bElab.innerText = "Segna in elaborazione";
                    bElab.onclick = async () => {
                        await db.ref("comande/"+id).update({ [statoKey]:"in elaborazione" });
                        const checkboxes = d.querySelectorAll(".tickItem");
                        checkboxes.forEach(cb => cb.disabled = false);
                    };
                    buttonsDiv.appendChild(bElab);
                }

                bComp = document.createElement("button");
                bComp.innerText = "Segna completato";

                if (ruolo === "cucina" || ruolo === "bere" || (ruolo === "snack" && snackAbilitato)) {
                    const aggiornaStatoPulsante = () => {
                        const checkboxes = d.querySelectorAll(".tickItem");
                        const tuttiSpuntati = [...checkboxes].length > 0 && [...checkboxes].every(cb => cb.checked);
                        bComp.disabled = !tuttiSpuntati;
                    };
                    aggiornaStatoPulsante();
                    d.addEventListener("change", e => {
                        if (e.target.classList.contains("tickItem")) aggiornaStatoPulsante();
                    });
                }


                bComp.onclick = async () => {
                    if ((ruolo === "cucina" || ruolo === "bere" || (ruolo === "snack" && snackAbilitato)) &&
                    [...d.querySelectorAll(".tickItem")].some(cb => !cb.checked)) return;

                    await aggiornaStatoConTermine(id, statoKey, "completato");
                    if (window.tickState && window.tickState[id]) delete window.tickState[id];
                };

                buttonsDiv.appendChild(bComp);
                statoDiv.appendChild(buttonsDiv);
            }

            if (c.note && c.noteDestinazioni && c.noteDestinazioni.includes(ruolo)) {
                const noteDiv = document.createElement("div");
                noteDiv.innerHTML = `<i>Note: ${c.note}</i>`;
                noteDiv.style.color = "#555";
                noteDiv.style.margin = "4px 0 0 2cm";
                d.appendChild(noteDiv);
            }


            d.appendChild(statoDiv);

            // 🔹 Orario invio
            const timeDiv = document.createElement("div");
            timeDiv.className = "orderTime";
            timeDiv.textContent = `🕒 Inviata alle ${c.orario || "—"}`;
            d.appendChild(timeDiv);

            // 🔹 Nuova comanda lampeggio + suono + notifica
            if (c[statoKey] === "da fare") {
                d.classList.add("newOrder", "blink");
                setTimeout(() => d.classList.remove("blink"), 3000);

            let storageKey =
                ruoloEffettivo === "cucina" ? "comandeNotificateCucina" :
                ruoloEffettivo === "bere"   ? "comandeNotificateBere" :
                                            "comandeNotificateSnack";

            let setNotifiche = window[storageKey] || new Set(JSON.parse(localStorage.getItem(storageKey) || "[]"));

            // Se nuova comanda per quel ruolo → notifica separata
            if (!setNotifiche.has(id)) {
                playDing();

                let titolo =
                    ruoloEffettivo === "cucina" ? `Nuova comanda #${c.numero}` :
                    ruoloEffettivo === "bere"   ? `Nuova comanda #${c.numero}` :
                                                `Nuova comanda #${c.numero}`;

                notify(titolo, "info");

                setNotifiche.add(id);
                localStorage.setItem(storageKey, JSON.stringify([...setNotifiche]));
                window[storageKey] = setNotifiche;
            }

            } else {
                d.classList.remove("newOrder", "blink");
                    let storageKey =
                        ruoloEffettivo === "cucina" ? "comandeNotificateCucina" :
                        ruoloEffettivo === "bere"   ? "comandeNotificateBere" :
                                                    "comandeNotificateSnack";

                    let setNotifiche = window[storageKey] || new Set(JSON.parse(localStorage.getItem(storageKey) || "[]"));

                    if (setNotifiche.has(id)) {
                        setNotifiche.delete(id);
                        localStorage.setItem(storageKey, JSON.stringify([...setNotifiche]));
                        window[storageKey] = setNotifiche;
                    }
            }

            // 🔹 Inserisci nei container
            if (c[statoKey] === "da fare" || c[statoKey] === "in elaborazione") {
                if (ruolo === "snack" && snackAbilitato) {
                    if (window.settings.nuoveInAltoSnack) daFareContainer.prepend(d);
                    else daFareContainer.appendChild(d);
                } else {
                    if (nuoveInAlto) daFareContainer.prepend(d);
                    else daFareContainer.appendChild(d);
                }
            } else {
                storicoContainer.prepend(d);
            }

            if (daFareContainer.filterCurrentOrders) daFareContainer.filterCurrentOrders();
            if (storicoContainer.filterCurrentOrders) storicoContainer.filterCurrentOrders();
        });
    });
}
async function caricaIngredientiPerRuolo(ruolo) {
    if (!checkOnline(true)) return;
    const tabId = ruolo === "cucina" ? "ingredientiCucinaTab" :
                    ruolo === "bere" ? "ingredientiBereTab" :
                    "ingredientiSnackTab"; // nuovo tab per snack

    const container = document.getElementById(tabId);
    if (!container) return;

    container.innerHTML = "Caricamento ingredienti...";

    db.ref("ingredienti").on("value", async snap => {
        const data = snap.val() || {};
        container.innerHTML = "";

        // 🔹 Aggiorna globalmente le unità anche per i menu dei ruoli
        window.ingredientData = data;

        // 🔹 Se esiste una funzione di aggiornamento menu per ruolo, richiamala
        if (typeof aggiornaMenuRuolo === "function") {
            aggiornaMenuRuolo();
        }

        // 🔹 Filtra categorie in base al ruolo
        let categorieRuolo;

        if (ruolo === "cucina") {
            const snapSnack = await db.ref("impostazioni/snackAbilitato").once("value");
            const snackAttivo = snapSnack.exists() && snapSnack.val() === true;
            // Se snack disabilitato → includi snack in cibi
            categorieRuolo = snackAttivo ? ["cibi"] : ["cibi", "snack"];
        } else if (ruolo === "snack") {
            const snapSnack = await db.ref("impostazioni/snackAbilitato").once("value");
            const snackAttivo = snapSnack.exists() && snapSnack.val() === true;
            categorieRuolo = snackAttivo ? ["snack"] : [];
        } else { // ruolo === "bere"
            categorieRuolo = ["bevande"];
        }



        // Raggruppa ingredienti per categoria
        const categorie = {};
        Object.entries(data).forEach(([id, ing]) => {
            if (!categorieRuolo.includes(ing.categoria)) return;
            if (!categorie[ing.categoria]) categorie[ing.categoria] = [];
            categorie[ing.categoria].push({ id, ...ing });
        });

        // Per ogni categoria
        Object.entries(categorie).forEach(([cat, items]) => {
            const catDiv = document.createElement("div");
            const h3 = document.createElement("h3");
            h3.innerText = cat.charAt(0).toUpperCase() + cat.slice(1);
            catDiv.appendChild(h3);

            items.forEach(ing => {
                const row = document.createElement("div");
                row.style.display = "flex";
                row.style.alignItems = "center";
                row.style.gap = "8px";
                row.style.marginBottom = "6px";

                // Nome ingrediente
                const nameSpan = document.createElement("span");
                nameSpan.innerText = ing.nome;
                nameSpan.style.flex = "1";

                // 🔹 Nuovo span per l'unità di misura
                const unitaSpan = document.createElement("span");
                unitaSpan.innerText = ing.unita || "pz"; // default "pz"
                unitaSpan.style.width = "40px";          // puoi regolare la larghezza
                unitaSpan.style.textAlign = "center";

                // Quantità
                const qtyInput = document.createElement("input");
                qtyInput.type = "number";
                qtyInput.min = 0;
                abilitaIncrementoDinamico(qtyInput);
                qtyInput.value = ing.rimanente === null || ing.rimanente === undefined ? "" : ing.rimanente;
                qtyInput.style.width = "70px";
                qtyInput.step = "any";
                qtyInput.onchange = async (e) => {
                    let newQty = e.target.value === "" ? null : parseFloat(e.target.value);
                    if (newQty !== null && (isNaN(newQty) || newQty < 0)) newQty = 0;
                    await db.ref(`ingredienti/${ing.id}`).update({
                        rimanente: newQty,
                        disponibile: newQty === null ? true : (newQty > 0)
                    });
                };


                // Stato
                const statoSpan = document.createElement("span");
                statoSpan.style.fontWeight = "bold";
                const isEsaurito = (ing.rimanente === 0);
                statoSpan.style.color = isEsaurito ? "red" : "green";
                statoSpan.innerText = isEsaurito ? "Esaurito" : "Disponibile";

                // Bottone disponibile
                const btnDisp = document.createElement("button");
                btnDisp.innerText = "Disponibile";
                btnDisp.onclick = async () => {
                    await db.ref(`ingredienti/${ing.id}`).update({ rimanente: null, disponibile: true });
                };

                // Bottone esaurito
                const btnEs = document.createElement("button");
                btnEs.innerText = "Esaurito";
                btnEs.onclick = async () => {
                    await db.ref(`ingredienti/${ing.id}`).update({ rimanente: 0, disponibile: false });
                };

                // Append elementi con stile simile ad admin
                row.appendChild(nameSpan);
                row.appendChild(qtyInput);
                row.appendChild(unitaSpan);
                row.appendChild(statoSpan);
                row.appendChild(btnDisp);
                row.appendChild(btnEs);

                // Aggiungi al div categoria
                catDiv.appendChild(row);

                // linea orizzontale
                const hr = document.createElement("hr");
                hr.style.margin = "4px 0";
                catDiv.appendChild(hr);
            });

            container.appendChild(catDiv);
        });
    });
}
// -------------------- UTENTI --------------------
async function caricaUtenti(){
    if (!checkOnline(true)) return;
    showLoader();
    const div = document.getElementById("listaUtenti");
    if(!div) return;
    div.innerHTML = "";

    const categorie = ["admin", "cassa", "bere", "cucina"];
    let snackAttivo = false;

    // 🔹 Controlla se snack è abilitato in impostazioni
    try {
        const snapSnack = await db.ref("impostazioni/snackAbilitato").once("value");
        snackAttivo = snapSnack.exists() && snapSnack.val() === true;
    } catch (err) {
        console.warn("Errore lettura impostazione snackAbilitato:", err);
    }

    if (snackAttivo) {
        categorie.push("snack");
    } else {
        // 🔹 Aggiorna utenti snack in cucina se disattivato
        db.ref("utenti").once("value").then(snapshot => {
            snapshot.forEach(snap => {
                const u = snap.val();
                if (u && u.ruolo === "snack") {
                    db.ref("utenti/" + snap.key).update({ ruolo: "cucina" });
                }
            });
        });

        // 🔹 Se disattivato, migra eventuali utenti snack in cucina
        db.ref("utenti").once("value").then(snapshot => {
            snapshot.forEach(snap => {
                const u = snap.val();
                if (u && u.ruolo === "snack") {
                    db.ref("utenti/" + snap.key).update({ ruolo: "cucina" });
                }
            });
        });
    }


    const categorieDiv = {};

    // Attesa: titolo + contenitore per gli utenti non approvati
    const attesaDiv = document.createElement("div");
    const hAttesa = document.createElement("h3");
    hAttesa.innerText = "Utenti in attesa di approvazione";
    attesaDiv.appendChild(hAttesa);
    const attesaList = document.createElement("div");
    attesaList.id = "attesaList";
    attesaDiv.appendChild(attesaList);
    div.appendChild(attesaDiv);

    // Categorie utenti
    categorie.forEach(cat => {
        const catDiv = document.createElement("div");
        catDiv.id = "cat_" + cat;

        const h = document.createElement("h3");
        h.innerText = cat.charAt(0).toUpperCase() + cat.slice(1);
        catDiv.appendChild(h);

        const listDiv = document.createElement("div");
        listDiv.id = "cat_list_" + cat;
        catDiv.appendChild(listDiv);

        div.appendChild(catDiv);
        categorieDiv[cat] = listDiv;
    });

    // Rimuovo listener precedente
    db.ref("utenti").off("value");
    const utentiNotificati = new Set();
    db.ref("utenti").off("child_added");
    // 🔥 Mostra la notifica SOLO se sei nella pagina admin
    if (window.isLoggedInAdmin) {
        db.ref("utenti").on("child_added", snap => {
            const u = snap.val();
            const id = snap.key;
            if (u && u.approvato === false && !utentiNotificati.has(id)) {
                notify(`👤 Nuovo utente in attesa di approvazione: ${u.username || "(senza nome)"}`, "info");
                utentiNotificati.add(id);
            }
        });
    }
    db.ref("utenti").on("value", snap => {
        attesaList.innerHTML = "";
        categorie.forEach(cat => { categorieDiv[cat].innerHTML = ""; });

        snap.forEach(s => {
            const u = s.val();
            const id = s.key;

            // Escludi l’admin specifico
            if(u.username === "gastrobo.mabo@gmail.com") return;
            // Escludi admin corrente (opzionale)
            if(u && u.ruolo === "admin" && typeof uid !== "undefined" && id === uid) return;

            // crea riga utente
            const d = document.createElement("div");
            d.style.display = "flex";
            d.style.justifyContent = "space-between";
            d.style.alignItems = "center";
            d.style.marginBottom = "5px";
            d.style.borderBottom = "1px solid #ccc";
            d.style.padding = "2px 0";

            const infoSpan = document.createElement("span");

            // Stato online/offline
            const stato = u.status?.state || "offline";
            // Ultimo accesso
            const last = u.status?.last_changed 
                ? new Date(u.status.last_changed).toLocaleString() 
                : "Mai";

            // Colore verde se online, grigio se offline
            const colore = stato === "online" ? "green" : "gray";

            infoSpan.innerHTML = `
                ${u.username || "(no username)"} 
                (<span style="color:${colore}">${stato.toUpperCase()}</span>) 
                - Ultimo accesso: ${last}
            `;

            d.appendChild(infoSpan);


            // Container bottoni
            const btnContainer = document.createElement("span");

            // Select ruolo
            const selectRole = document.createElement("select");
            const ruoliBase = ["cassa", "bere", "cucina", "admin"];
            if (snackAttivo) ruoliBase.splice(4, 0, "snack");

            ruoliBase.forEach(r => {
                const opt = document.createElement("option");
                opt.value = r;
                opt.innerText = r === "--" ? "--" : r.charAt(0).toUpperCase() + r.slice(1);
                selectRole.appendChild(opt);
            });

            selectRole.value = (u.ruolo === "utente") ? "--" : (u.ruolo || "--");
            selectRole.onchange = async () => {
                const val = selectRole.value === "--" ? "utente" : selectRole.value;
                try {
                    await db.ref("utenti/" + id).update({ ruolo: val });
                    notify("Ruolo aggiornato!", "info");
                    caricaUtenti(); // 🔁 aggiorna la lista
                } catch (err) {
                    notify("Errore: " + err.message, "error");
                }
            };
            selectRole.style.marginLeft = "5px";
            btnContainer.appendChild(selectRole);

            // Toggle attivo/disattivo
            const toggleActive = document.createElement("button");
            toggleActive.innerText = u.attivo ? "Attivo" : "Disattivo";
            toggleActive.style.marginLeft = "5px";
            toggleActive.onclick = () => {
                const nuovoStato = !u.attivo;
                db.ref("utenti/" + id).update({ attivo: nuovoStato });
            };
            btnContainer.appendChild(toggleActive);

            // Aggiornamento realtime del toggle
            db.ref("utenti/" + id).on("value", snap => {
                const val = snap.val();
                if(val) toggleActive.innerText = val.attivo ? "Attivo" : "Disattivo";
            });

            // Tasto forza logout con notify interattivo
            const btnDisconnect = document.createElement("button");
            btnDisconnect.innerText = "Disconnetti";
            btnDisconnect.style.marginLeft = "5px"
            btnDisconnect.onclick = async () => {
                try {
                    const snap = await db.ref("/utenti/" + id + "/status").once("value");
                    const stato = snap.val() || {};
                    
                    if (stato.state === "offline") {
                        notify(`${u.username} è già offline`, "info");
                        return;
                    }
                    question(`Vuoi davvero disconnettere ${u.username}?`, {
                        confirmText: "Conferma",
                        cancelText: "Annulla",
                        onConfirm: async () => {
                            try {
                                await db.ref("/utenti/" + id + "/status").set({
                                    state: "offline",
                                    forzato: true,
                                    last_changed: firebase.database.ServerValue.TIMESTAMP
                                });
                                notify(`${u.username} è stato disconnesso`, "info");
                            } catch(err) {
                                notify("Errore: " + err.message, "error");
                            }
                        }
                    });
                } catch(err) {
                    notify("Errore lettura stato utente: " + err.message, "error");
                }
            };
            btnContainer.appendChild(btnDisconnect);

            // Tasto elimina
            const bDel = document.createElement("button");
            bDel.innerText = "Elimina";
            bDel.className = "delete";
            bDel.style.marginLeft = "5px";
            bDel.onclick = () => {
                question("Eliminare questo utente?", {
                    confirmText: "Conferma",
                    cancelText: "Annulla",
                    onConfirm: async () => {
                        try {
                            await db.ref("utenti/" + id).remove();
                            caricaUtenti(); 
                        } catch (err) {
                            notify("Errore: " + err.message, "error");
                        }
                    }
                    // onCancel opzionale, non serve fare nulla
                });
            };

            btnContainer.appendChild(bDel);

            d.appendChild(btnContainer);

            // Append riga nel posto giusto
            if(!u.approvato){
                // --- Tasto Approva (solo se non approvato) ---
                const btnApprova = document.createElement("button");
                btnApprova.innerText = "Approva";
                btnApprova.className = "primaryButton";  // usa la tua classe dei bottoni
                btnApprova.style.marginLeft = "5px";
                btnApprova.style.padding = "6px 10px";
                btnApprova.style.borderRadius = "6px";
                btnApprova.style.cursor = "pointer";
                btnApprova.style.fontSize = "14px"; // uguale agli altri
                btnApprova.onclick = async () => {
                    const ruoloScelto = selectRole.value;
                    if (ruoloScelto === "" || ruoloScelto === "utente") {
                        notify("⚠️ Assegna prima un ruolo all’utente!", "warn");
                        return;
                    }
                    try {
                        await db.ref("utenti/" + id).update({
                            approvato: true,
                            ruolo: ruoloScelto
                        });
                        notify(`✅ ${u.username} approvato come ${ruoloScelto}`, "info");
                        caricaUtenti(); // 🔁 aggiorna la lista
                    } catch (err) {
                        notify("❌ Errore durante l'approvazione: " + err.message, "error");
                    }
                };

                btnContainer.appendChild(btnApprova);

                attesaList.appendChild(d);
            } else {
                const role = u.ruolo || "utente";
                if(categorie.includes(role)){
                    categorieDiv[role].appendChild(d);
                } else {
                    div.appendChild(d);
                }
            }
        });
    });
    hideLoader();
}
// -------------------- MENU (ADMIN) --------------------
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("aggiungiMenuBtn").onclick = async () => {
        if (!checkOnline(true)) return;
        const nome = document.getElementById("piattoNome").value.trim();
        const prezzo = parseFloat(document.getElementById("piattoPrezzo").value);
        const categoria = document.getElementById("piattoCat").value;

        if(!nome || isNaN(prezzo)){
            notify("Inserisci nome e prezzo validi!", "warn");
            return;
        }

        const ingredienti = Object.keys(window.selectedMap)
            .filter(id => id && window.ingredientData[id])
            .map(id => ({
                id,
                nome: window.ingredientData[id].nome,
                qtyPerUnit: window.selectedMap[id],
                unita: window.ingredientData[id].unita || "pz"   // 🔹 salva anche l’unità
            }));

        try {
            await db.ref("menu").push({ nome, prezzo, categoria, ingredienti });
            
            document.getElementById("piattoNome").value = "";
            document.getElementById("piattoPrezzo").value = "";

            window.selectedMap = {}; 
            aggiornaOpzioniIngredientiMenu();

            db.ref("ingredienti").once("value").then(snap => {
                ingredientData = snap.val() || {};
                aggiornaOpzioniIngredientiMenu();
            });

        } catch(err){
            notify("Errore nell'aggiunta: " + err.message, "error");
        }
    };
    db.ref("ingredienti").on("value", snap => {
        // RIGA RIMOSSA: db.ref("menu").off(); 
        
        window.ingredientData = snap.val() || {};
        
        // Se la tab "Menu" è attiva, aggiorna subito per riflettere i cambi ingredienti
        const menuTab = document.getElementById("menuTab");
        if (menuTab && menuTab.classList.contains("active")) {
            // caricaMenuAdmin gestisce già la pulizia dei propri listener internamente se necessario
            caricaMenuAdmin(); 
        }
        
        // Se siamo in Cassa, aggiorniamo i bottoni (perché window.ingredientData è cambiato)
        if (window.isLoggedInCassa || (window.isLoggedInAdmin && !document.getElementById("cassaDiv").classList.contains("hidden"))) {
            if (typeof aggiornaBottoniBloccati === "function") {
                aggiornaBottoniBloccati();
            }
        }
    });
});
function caricaMenuAdmin(){
    if (!checkOnline(true)) return;
    const div = document.getElementById("menuAdmin");
    db.ref("menu").on("value", snap => {
        div.innerHTML = "";

        const data = snap.val() || {};
        const categorie = { cibi: [], bevande: [], snack: [] };

        for(let id in data){
            const piatto = data[id];
            if (!piatto || !piatto.categoria) continue;
            if(!categorie[piatto.categoria]) categorie[piatto.categoria] = [];
            categorie[piatto.categoria].push({id, ...piatto});
        }

        for(const cat of ["cibi","bevande","snack"]){
            const h = document.createElement("h4");
            h.innerText = cat.charAt(0).toUpperCase() + cat.slice(1);
            div.appendChild(h);

            if(categorie[cat].length === 0){
                const p = document.createElement("p");
                p.innerText = "Nessun piatto";
                div.appendChild(p);
            }

            categorie[cat].forEach(piatto=>{
                const d = document.createElement("div");
                d.style.display = "flex";
                d.style.justifyContent = "space-between";
                d.style.alignItems = "center";
                d.style.marginBottom = "6px";

                const left = document.createElement("div");
                left.innerHTML = `<b>${piatto.nome}</b> (€${piatto.prezzo})`;
                if (piatto.ingredienti && piatto.ingredienti.length) {
                    const ingTxt = piatto.ingredienti.map(i => {
                        // 🔹 se l'unità non è nel piatto, la prende dal database ingredienti
                        const unita = (window.ingredientData?.[i.id]?.unita) || i.unita || "pz";
                        const qty = i.qtyPerUnit || 1;
                        return `${i.nome} x${qty} ${unita}`;
                    }).join(", ");
                    left.innerHTML += `<div style="font-size:0.9em;color:#444;">Ingredienti: ${ingTxt}</div>`;
                }


                d.appendChild(left);

                const right = document.createElement("div");
                // Bottone per bloccare/sbloccare piatto manualmente
                const bBlocca = document.createElement("button");
                bBlocca.style.marginLeft = "6px";
                bBlocca.style.color = "white";

                function aggiornaAspettoBlocca() {
                    const bloccato = piatto.bloccato === true;
                    bBlocca.innerText = bloccato ? "🔒 Bloccato" : "✅ Sbloccato";
                    bBlocca.style.background = bloccato ? "#ff6666" : "#66bb6a";
                }
                aggiornaAspettoBlocca();

                bBlocca.onclick = async () => {
                    bBlocca.disabled = true;
                    const nuovoStato = !(piatto.bloccato === true);
                    await db.ref("menu/" + piatto.id + "/bloccato").set(nuovoStato);
                    bBlocca.disabled = false;
                    aggiornaAspettoBlocca();
                    notify(`🍽️ ${piatto.nome} è ora ${nuovoStato ? "bloccato" : "sbloccato"}`, "info");

                    // ❗ Aggiorna menuData in cassa e rinfresca bottoni
                    db.ref("menu").once("value").then(snap => {
                        window.menuData = snap.val() || {};
                        aggiornaBottoniBloccati();
                    });


                    // 🔹 Aggiorna menuData in cassa e refresh bottoni
                    db.ref("menu").once("value").then(snap => {
                        window.menuData = snap.val() || {};
                        aggiornaBottoniBloccati();
                    });
                };


                right.appendChild(bBlocca);
                const bEdit = document.createElement("button");
                bEdit.innerText = "Modifica";
                bEdit.style.marginRight = "6px";
                bEdit.onclick = () => modificaPiattoMenu(piatto.id, piatto);
                right.appendChild(bEdit);

                const bDel = document.createElement("button");
                bDel.innerText = "Elimina";
                bDel.className = "delete";
                bDel.onclick = () => {
                    question(`Eliminare il piatto "${piatto.nome}"?`, {
                        confirmText: "Conferma",
                        cancelText: "Annulla",
                        onConfirm: async () => {
                            try {
                                await db.ref("menu/" + piatto.id).remove();
                            } catch (err) {
                                notify("Errore: " + err.message, "error");
                            }
                        },
                        // onCancel opzionale, non serve fare nulla
                    });
                };
                right.appendChild(bDel);
                d.appendChild(right);
                div.appendChild(d);
                // LINEA ORIZZONTALE
                const hr = document.createElement("hr");
                hr.style.margin = "4px 0";
                div.appendChild(hr);
            });
        }
    });
}
function modificaPiattoMenu(menuId, piatto) {
    if (!checkOnline(true)) return;
    const existing = document.getElementById("admin_edit_menu_" + menuId);
    if (existing) { existing.scrollIntoView({ behavior: "smooth" }); return; }
    
    const tab = document.getElementById("menuTab");
    const panel = document.createElement("div");
    panel.id = "admin_edit_menu_" + menuId;
    panel.style.border = "1px solid #ccc";
    panel.style.padding = "10px";
    panel.style.margin = "8px 0";
    panel.style.background = "#fffefc";

    const nomeInput = document.createElement("input");
    nomeInput.type = "text"; nomeInput.value = piatto.nome || ""; nomeInput.style.marginRight = "8px";

    const prezzoInput = document.createElement("input");
    prezzoInput.type = "number"; prezzoInput.step = "0.01"; prezzoInput.value = (typeof piatto.prezzo !== "undefined") ? piatto.prezzo : ""; prezzoInput.style.marginRight = "8px"; prezzoInput.style.width = "120px";

    const catSelect = document.createElement("select");
    ["cibi","bevande","snack"].forEach(c=>{
        const o = document.createElement("option"); o.value = c; o.innerText = c;
        if(piatto.categoria === c) o.selected = true;
        catSelect.appendChild(o);
    });
    catSelect.style.marginRight = "8px";

    const row1 = document.createElement("div");
    row1.style.display = "flex"; row1.style.alignItems = "center"; row1.style.gap = "8px"; row1.style.marginBottom = "8px";
    row1.appendChild(document.createTextNode("Nome:"));
    row1.appendChild(nomeInput);
    row1.appendChild(document.createTextNode("Prezzo:"));
    row1.appendChild(prezzoInput);
    row1.appendChild(document.createTextNode("Categoria:"));
    row1.appendChild(catSelect);

    const row2 = document.createElement("div");
    row2.style.marginBottom = "8px";
    row2.appendChild(document.createTextNode("Ingredienti (seleziona):"));

    const ingrContainer = document.createElement("div");
    ingrContainer.style.marginTop = "6px";
    ingrContainer.style.marginBottom = "6px";

    // 1️⃣ reset mappa e container
    window.selectedMap = {};   // rimuove i tick del piatto precedente
    ingrContainer.innerHTML = ""; // pulisce eventuali checkbox precedenti

    // 2️⃣ popola la mappa solo con gli ingredienti del piatto corrente
    (piatto.ingredienti || []).forEach(i => {
        if(i.id) window.selectedMap[i.id] = i.qtyPerUnit || 1; // tick + quantità
    });

    // 3️⃣ renderizza gli ingredienti con i tick già selezionati
    renderIngredientOptionsForCategory(piatto.categoria || 'cibi', ingrContainer, window.selectedMap);



    panel.appendChild(row1);
    panel.appendChild(row2);
    panel.appendChild(ingrContainer);
    // se cambio categoria mentre modifico, ricostruisco la lista (non preservo selezioni su categoria diversa)
    catSelect.addEventListener("change", ()=> renderIngredientOptionsForCategory(catSelect.value, ingrContainer, window.selectedMap));

    const actions = document.createElement("div");
    actions.style.marginTop = "6px";

    const btnSalva = document.createElement("button");
    btnSalva.innerText = "Salva modifiche";
    btnSalva.onclick = async () => {
        const newName = nomeInput.value.trim();
        const newPrezzo = parseFloat(prezzoInput.value);
        const newCat = catSelect.value;
        if(!newName || isNaN(newPrezzo)){ notify("Nome e prezzo validi sono obbligatori.", "warn"); return; }

        // leggo dalle checkbox in ingrContainer
        const ingredienti = [];
        const rows = Array.from(ingrContainer.querySelectorAll("div"));
        rows.forEach(r=>{
            const chk = r.querySelector('input[type="checkbox"]');
            if(chk && chk.checked){
                const id = chk.dataset.ingredId;
                const qtyInput = r.querySelector('input[type="number"]');
                const qty = qtyInput && qtyInput.value ? parseFloat(qtyInput.value) || 1 : 1;
                if(ingredientData[id]) ingredienti.push({
                    id,
                    nome: ingredientData[id].nome,
                    qtyPerUnit: qty,
                    unita: ingredientData[id].unita || "pz"   // 🔹 aggiunta unità
                });

            }
        });

        try {
            await db.ref("menu/" + menuId).update({
                nome: newName,
                prezzo: newPrezzo,
                categoria: newCat,
                ingredienti: ingredienti
            });
            if(panel && panel.parentNode) panel.parentNode.removeChild(panel);
        } catch(err){
            notify("Errore salvataggio: " + err.message, "error");
        }
    };

    const btnAnnulla = document.createElement("button");
    btnAnnulla.innerText = "Annulla";
    btnAnnulla.style.marginLeft = "8px";
    btnAnnulla.onclick = () => { if(panel && panel.parentNode) panel.parentNode.removeChild(panel); window.selectedMap = {}; aggiornaOpzioniIngredientiMenu(); };

    actions.appendChild(btnSalva); actions.appendChild(btnAnnulla);
    panel.appendChild(actions);

    tab.prepend(panel);
    panel.scrollIntoView({ behavior: "smooth" });
}
// -------------------- STATISTICHE ADMIN --------------------
async function caricaStatistiche() {
    if (!checkOnline(true)) return;
    showLoader();
  // Assicuro che esista il contenitore (non ricreo i bottoni se sono già in HTML)
  const incassiTab = document.getElementById("incassiTab");
  if (!document.getElementById("contenutoStatistiche")) {
    incassiTab.innerHTML = `
      <h3>Statistiche Incassi</h3>
      <div style="margin-bottom:10px;">
        <button id="generaExcelBtn">📊 Esporta Excel</button>
        <button id="generaPdfBtn">📄 Esporta PDF</button>
      </div>
      <div id="contenutoStatistiche"></div>
    `;
  }
  const contenuto = document.getElementById("contenutoStatistiche");

  const snap = await db.ref("comande").once("value");
  const comande = snap.val() || {};

  let totaleComande = 0;
  let totaleIncasso = 0;
    let totalePos = 0;
    let totaleContanti = 0;
  const piattiMap = {};            // { nome: { quantita, incasso } }
  const ingrMap = {};              // { nome: quantita }
  const incassiIngredienti = {};   // { nome: incasso } (come prima, somma del prezzo del piatto)

  const listaComande = [];

  for (const id in comande) {
    const c = comande[id];
    totaleComande++;
    let totaleComanda = 0;

    (c.piatti || []).forEach(p => {
    const q = Number(p.quantita || 0);
    const prezzoTot = calcolaPrezzoConSconto(p);
    totaleComanda += prezzoTot;

    // Piatti
    if (!piattiMap[p.nome]) piattiMap[p.nome] = { quantita: 0, incasso: 0 };
    piattiMap[p.nome].quantita += q;
    piattiMap[p.nome].incasso += prezzoTot;

    // Ingredienti
    (p.ingredienti || []).forEach(ing => {
        const qty = (Number(ing.qtyPerUnit) || 1) * q;
        ingrMap[ing.nome] = (ingrMap[ing.nome] || 0) + qty;
        incassiIngredienti[ing.nome] = (incassiIngredienti[ing.nome] || 0) + prezzoTot;
    });
    });

    // ⚡ Aggiorna totale POS/Contanti solo una volta per comanda
    if (c.metodoPagamento === "pos") {
    totalePos += totaleComanda;
    } else {
    totaleContanti += totaleComanda;
    }
    totaleIncasso += totaleComanda;


    // uso il campo "numero" che viene salvato al push della comanda (es. "12A")
    listaComande.push({
      id,
      numero: c.numero || "",             // correzione: leggi 'numero' direttamente dal DB
      totale: totaleComanda.toFixed(2),
      timestamp: c.timestamp || 0
    });
  }

  // ORDINAMENTI
  listaComande.sort((a,b) => (a.timestamp || 0) - (b.timestamp || 0)); // cronologico
  const piattiByQuantita = Object.entries(piattiMap).sort((a,b) => b[1].quantita - a[1].quantita);
  const piattiByIncasso = Object.entries(piattiMap).sort((a,b) => b[1].incasso - a[1].incasso);
  const ingrByQuantita = Object.entries(ingrMap).sort((a,b) => b[1] - a[1]);
  const ingrIncassiArray = Object.entries(incassiIngredienti).map(([n,i]) => ({ nome: n, incasso: i }));

  // salvo per gli export
    window.statistiche = {
    totaleComande,
    totaleIncasso,
    totalePos,
    totaleContanti,
    piattiByQuantita,
    piattiByIncasso,
    ingrByQuantita,
    ingrIncassiArray,
    listaComande
    };

  // RIEPILOGO IN-APP: esattamente Piatto | Quantità venduta | Incasso (nient'altro)
  const rows = piattiByQuantita.map(([nome, v]) =>
    `<tr><td style="text-align:left; padding:6px;">${nome}</td><td style="text-align:center; padding:6px;">${v.quantita}</td><td style="text-align:right; padding:6px;">€${v.incasso.toFixed(2)}</td></tr>`
  ).join("");

    contenuto.innerHTML = `
    <h3 style="color:blue;">Statistiche Vendite</h3>
    <p><b>Numero totale comande:</b> ${totaleComande}</p>
    <p><b>Incasso totale:</b> €${totaleIncasso.toFixed(2)}</p>
    <p><b>Incasso POS:</b> €${totalePos.toFixed(2)}</p>
    <p><b>Incasso Contanti:</b> €${totaleContanti.toFixed(2)}</p>
    <table border="0" style="width:100%; border-collapse:collapse;">
        <thead>
        <tr style="border-bottom:2px solid #444;">
            <th style="text-align:left; padding:6px;">Piatto</th>
            <th style="text-align:center; padding:6px;">Quantità</th>
            <th style="text-align:right; padding:6px;">Incasso</th>
        </tr>
        </thead>
        <tbody>
        ${rows.replace(/<\/tr>/g,"</tr><tr style='border-bottom:1px solid #ccc;'></tr>")}
        </tbody>
    </table>
    `;



  // ricollego i bottoni (se esistono)
  const excelBtn = document.getElementById("generaExcelBtn");
  const pdfBtn = document.getElementById("generaPdfBtn");
  if (excelBtn) excelBtn.onclick = generaExcel;
  if (pdfBtn) pdfBtn.onclick = generaPdf;
  hideLoader();
}
// --- EXCEL PDF ---
async function generaExcel() {
    if (!checkOnline(true)) return;
  const s = window.statistiche;
  if (!s) { notify("Nessuna statistica disponibile","warn"); return; }

  const { piattiByIncasso, piattiByQuantita, ingrByQuantita, totaleComande, totaleIncasso, totalePos, totaleContanti } = s;

  const workbook = new ExcelJS.Workbook();

  // ----------------- Scheda 1: Piatti x Incasso -----------------
  const sheet1 = workbook.addWorksheet("Piatti x Incasso");
  sheet1.columns = [
    { header: "Piatto", key: "nome", width: 30 },
    { header: "Quantità", key: "quantita", width: 15 },
    { header: "Incasso", key: "incasso", width: 15 }
  ];

  // Titoli gialli e grassetto
  sheet1.getRow(1).eachCell(cell => {
    cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFF00'} };
    cell.font = { bold:true };
  });

  // Aggiungi dati piatti e formatta colonna Incasso come valuta
  piattiByIncasso.forEach(p => {
    const row = sheet1.addRow({ nome: p[0], quantita: p[1].quantita, incasso: Number(p[1].incasso.toFixed(2)) });
    row.getCell('C').numFmt = '€#,##0.00';
  });

  // Totali a fianco (colonne E/F)
  sheet1.getCell('E2').value = "Numero totale comande";
  sheet1.getCell('F2').value = totaleComande;      // rimane numero semplice
  sheet1.getCell('E3').value = "Incasso totale (€)";
  sheet1.getCell('F3').value = totaleIncasso;      // formato valuta
  sheet1.getCell('E4').value = "Incasso POS (€)";
    sheet1.getCell('F4').value = totalePos;
    sheet1.getCell('E5').value = "Incasso Contanti (€)";
    sheet1.getCell('F5').value = totaleContanti;

    // Formatta come valuta
    sheet1.getCell('F4').numFmt = '€#,##0.00';
    sheet1.getCell('F5').numFmt = '€#,##0.00';

    // Stile blu e grassetto come prima
    ['E4','F4','E5','F5'].forEach(addr => {
    const cell = sheet1.getCell(addr);
    cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'00B0F0'} };
    cell.font = { bold:true };
    });


  // Totali blu e grassetto
  ['E2','F2','E3','F3'].forEach(addr => {
    const cell = sheet1.getCell(addr);
    cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'00B0F0'} };
    cell.font = { bold:true };
  });
  // Formatta solo il totale incasso in € (F3)
  sheet1.getCell('F3').numFmt = '€#,##0.00';

  // Adatta larghezza colonne dei totali
  sheet1.getColumn(5).width = 25; // colonna E
  sheet1.getColumn(6).width = 15; // colonna F

  // ----------------- Scheda 2: Piatti x Quantità -----------------
  const sheet2 = workbook.addWorksheet("Piatti x Quantità");
  sheet2.columns = [
    { header: "Piatto", key: "nome", width: 30 },
    { header: "Quantità", key: "quantita", width: 15 },
    { header: "Incasso", key: "incasso", width: 15 }
  ];

  // Titoli gialli
  sheet2.getRow(1).eachCell(cell => {
    cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFF00'} };
    cell.font = { bold:true };
  });

  piattiByQuantita.forEach(p => {
    const row = sheet2.addRow({ nome: p[0], quantita: p[1].quantita, incasso: Number(p[1].incasso.toFixed(2)) });
    row.getCell('C').numFmt = '€#,##0.00';
  });

  // ----------------- Scheda 3: Ingredienti -----------------
  const sheet3 = workbook.addWorksheet("Ingredienti");
  sheet3.columns = [
    { header:"Ingrediente", key:"nome", width:30 },
    { header:"Quantità", key:"quantita", width:15 }
  ];

  // Titoli gialli
  sheet3.getRow(1).eachCell(cell => {
    cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFF00'} };
    cell.font = { bold:true };
  });

  ingrByQuantita.forEach(p => sheet3.addRow({ nome: p[0], quantita: p[1] }));

  // ----------------- Salva file -----------------
  const buf = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Statistiche_Incassi.xlsx';
  a.click();
  URL.revokeObjectURL(url);
}
function generaPdf() {
    if (!checkOnline(true)) return;
  const s = window.statistiche;
  if (!s) { notify("Nessuna statistica disponibile. Apri la tab Incassi prima.","warn"); return; }

  const { totaleComande, totaleIncasso, totalePos, totaleContanti, piattiByQuantita, piattiByIncasso, ingrByQuantita, ingrIncassiArray, listaComande } = s;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  let y = 14;
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  const xLeft = margin;
  const xCenter = Math.floor(pageW / 2);
  const xRight = pageW - margin;

  // Titolo principale
  doc.setFontSize(16);
  doc.setFont(undefined,'bold');
  doc.setTextColor(0,0,200); // blu
  doc.text("Report Incassi", xLeft, y);
  y += 8;

  // Totali
  doc.setFontSize(12);
  doc.text(`Numero totale comande: ${totaleComande}`, xLeft, y);
  y += 6;
  doc.text(`Incasso totale: €${totaleIncasso.toFixed(2)}`, xLeft, y);
  y += 10;
  doc.text(`Incasso POS: €${totalePos.toFixed(2)}`, xLeft, y);
    y += 6;
    doc.text(`Incasso Contanti: €${totaleContanti.toFixed(2)}`, xLeft, y);
    y += 10;


  // Tabella: Piatti per quantità
  doc.setFontSize(13);
  doc.setFont(undefined,'bold');
  doc.setTextColor(0,100,0); // verde
  doc.text("Piatti — per quantità", xLeft, y);
  y += 6;

  doc.setFontSize(11);
  doc.setFont(undefined,'normal');
  doc.setTextColor(0,0,0); // dati in nero
  doc.text("Piatto", xLeft, y);
  doc.text("Quantità", xCenter, y, { align: "center" });
  doc.text("Incasso", xRight, y, { align: "right" });
  y += 6;

  piattiByQuantita.forEach(([nome, v]) => {
    if (y > 275) { doc.addPage(); y = 20; }
    doc.text(String(nome), xLeft, y);
    doc.text(String(v.quantita), xCenter, y, { align: "center" });
    doc.text(`€${v.incasso.toFixed(2)}`, xRight, y, { align: "right" });
    y += 6;
  });

  // Piccolo spazio, poi Piatti per incasso
  y += 8;
  doc.setFontSize(13);
  doc.setFont(undefined,'bold');
  doc.setTextColor(0,100,0); // verde
  doc.text("Piatti — per incasso", xLeft, y);
  y += 6;
  doc.setFontSize(11);
  doc.setFont(undefined,'normal');
  doc.setTextColor(0,0,0); // dati in nero
  doc.text("Piatto", xLeft, y);
  doc.text("Quantità", xCenter, y, { align: "center" });
  doc.text("Incasso", xRight, y, { align: "right" });
  y += 6;

  piattiByIncasso.forEach(([nome,v]) => {
    if (y > 275) { doc.addPage(); y = 20; }
    doc.text(String(nome), xLeft, y);
    doc.text(String(v.quantita), xCenter, y, { align: "center" });
    doc.text(`€${v.incasso.toFixed(2)}`, xRight, y, { align: "right" });
    y += 6;
  });

  // Ingredienti (ordinati per utilizzo)
  y += 8;
  doc.setFontSize(13);
  doc.setFont(undefined,'bold');
  doc.setTextColor(0,100,0); // verde
  doc.text("Ingredienti — per utilizzo", xLeft, y);
  y += 6;
  doc.setFontSize(11);
  doc.setFont(undefined,'normal');
  doc.setTextColor(0,0,0); // dati in nero
  doc.text("Ingrediente", xLeft, y);
  doc.text("Quantità", xRight, y, { align: "right" });
  y += 6;

  ingrByQuantita.forEach(([nome, qty]) => {
    if (y > 275) { doc.addPage(); y = 20; }
    doc.text(String(nome), xLeft, y);
    doc.text(String(qty), xRight, y, { align: "right" });
    y += 6;
  });

  // Lista Comande cronologica — aggiunto data e ora
  y += 8;
  doc.setFontSize(13);
  doc.setFont(undefined,'bold');
  doc.setTextColor(0,100,0); // verde
  doc.text("Lista Comande (cronologica)", xLeft, y);
  y += 6;
  doc.setFontSize(11);
  doc.setFont(undefined,'normal');
  doc.setTextColor(0,0,0); // dati in nero
  doc.text("Data/Ora", xLeft, y);
  doc.text("Comanda", xCenter, y, { align: "center" });
  doc.text("Totale", xRight, y, { align: "right" });
  y += 6;

  const maxComanda = listaComande.reduce((max, c) => Number(c.totale) > Number(max.totale) ? c : max, {totale: 0});

  listaComande.forEach(c => {
    if(y > 275){ doc.addPage(); y=20; }

    // data e ora
    const ts = c.timestamp || 0;
    const date = ts ? new Date(ts) : null;
    const dateStr = date ? `${date.getDate().toString().padStart(2,'0')}/${(date.getMonth()+1).toString().padStart(2,'0')}/${date.getFullYear()} ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}` : "";

    // evidenzia comanda con massimo incasso
    if(c.id === maxComanda.id){
      doc.setFont(undefined,'bold');
      doc.setTextColor(255,200,0); // giallo
    } else {
      doc.setFont(undefined,'normal');
      doc.setTextColor(0,0,0);
    }

    doc.text(dateStr, xLeft, y); // data e ora a sinistra
    doc.text(String(c.numero || ""), xCenter, y, {align:"center"});
    doc.text(`€${c.totale}`, xRight, y, {align:"right"});
    y += 6;
  });

  doc.save("Statistiche_Incassi.pdf");
}
// -------------------- SCONTI ADMIN --------------------
function caricaScontiAdmin() {
    if (!checkOnline(true)) return;
    const div = document.getElementById("listaSconti");
    div.innerHTML = "";

    db.ref("menu").once("value").then(snap => {
        const data = snap.val() || {};

        for(let id in data){
            const piatto = data[id];

            const row = document.createElement("div");
            row.style.display = "flex";
            row.style.alignItems = "center";
            row.style.justifyContent = "space-between";
            row.style.marginBottom = "6px";
            row.style.borderBottom = "1px solid #ccc"; // <-- linea orizzontale
            row.style.paddingBottom = "4px";           // piccolo padding per estetica


            const nomeDiv = document.createElement("div");
            
            const prezzoNum = Number(piatto.prezzo) || 0;
            nomeDiv.innerHTML = `<b>${piatto.nome}</b> - Prezzo: €${prezzoNum.toFixed(2)}`;

            if(piatto.sconto){
                let scontoTxt;
                if(piatto.sconto.tipo === "percentuale") {
                    scontoTxt = `${piatto.sconto.valore}%`;
                } else if(piatto.sconto.tipo === "x_paga_y") {
                    scontoTxt = `Prendi ${piatto.sconto.valore.x} Paga ${piatto.sconto.valore.y} articoli`;
                } else if(piatto.sconto.tipo === "x_paga_y_fisso") {
                    scontoTxt = `Prendi ${piatto.sconto.valore.x} Paga €${piatto.sconto.valore.y.toFixed(2)}`;
                }
                nomeDiv.innerHTML += ` <span class="scontoTxt">(${scontoTxt})</span>`;

            }
            row.appendChild(nomeDiv);

            const actions = document.createElement("div");

            const btnMod = document.createElement("button");
            btnMod.innerText = piatto.sconto ? "Modifica" : "Imposta sconto";
            // passa la riga (row) come container di riferimento
            btnMod.onclick = () => mostraFormSconto(piatto, id, row);
            actions.appendChild(btnMod);

            const btnRimuovi = document.createElement("button");
            btnRimuovi.innerText = "Rimuovi sconto";
            btnRimuovi.style.marginLeft = "5px";
            btnRimuovi.onclick = () => {
                db.ref("menu/"+id+"/sconto").remove().then(() => caricaScontiAdmin());
            };

            actions.appendChild(btnRimuovi);

            row.appendChild(actions);
            div.appendChild(row);
        }
    });
}
function mostraFormSconto(piatto, id, containerRow) {
    // Rimuove eventuali form già aperti (eviti duplicati)
    document.querySelectorAll('.sconto-form').forEach(f => f.remove());

    // Crea il form
    const formDiv = document.createElement("div");
    formDiv.className = "sconto-form";
    formDiv.style.border = "1px solid #ccc";
    formDiv.style.padding = "8px";
    formDiv.style.margin = "6px 0";
    formDiv.style.background = "#fefefe";

    // Tipo select
    const tipoSelect = document.createElement("select");
    const optPerc = document.createElement("option");
    optPerc.value = "percentuale"; optPerc.innerText = "Percentuale";
    const optXPY = document.createElement("option");
    optXPY.value = "x_paga_y"; optXPY.innerText = "Prendi X Paga Y";
    const optXPYF = document.createElement("option");
    optXPYF.value = "x_paga_y_fisso"; optXPYF.innerText = "Prendi X Paga Y €";
    tipoSelect.appendChild(optPerc);
    tipoSelect.appendChild(optXPY);
    tipoSelect.appendChild(optXPYF);
    tipoSelect.value = piatto.sconto?.tipo || "percentuale";
    formDiv.appendChild(document.createTextNode("Tipo: "));
    formDiv.appendChild(tipoSelect);
    formDiv.appendChild(document.createTextNode(" "));

    // Input per percentuale
    const percInput = document.createElement("input");
    percInput.type = "number";
    percInput.min = 0;
    percInput.step = 0.1;
    percInput.style.width = "80px";
    percInput.value = (piatto.sconto && piatto.sconto.tipo === "percentuale") ? (piatto.sconto.valore || 0) : 0;
    formDiv.appendChild(percInput);

    // Input per X e Y (prendi X paga Y)
    const xInput = document.createElement("input");
    xInput.type = "number";
    xInput.min = 1;
    xInput.step = 1;
    xInput.style.width = "60px";
    xInput.style.marginLeft = "6px";
    xInput.value = (piatto.sconto && piatto.sconto.tipo === "x_paga_y") ? (piatto.sconto.valore?.x || 1) : 1;

    const yInput = document.createElement("input");
    yInput.type = "number";
    yInput.min = 1;
    yInput.step = 1;
    yInput.style.width = "60px";
    yInput.style.marginLeft = "4px";
    yInput.value = (piatto.sconto && piatto.sconto.tipo === "x_paga_y") ? (piatto.sconto.valore?.y || 1) : 1;

    // Mostra/nascondi gli input corretti in base al tipo
    function aggiornaVisibilita() {
        if (tipoSelect.value === "percentuale") {
            percInput.style.display = "inline-block";
            xInput.style.display = "none";
            yInput.style.display = "none";
        } else {
            percInput.style.display = "none";
            xInput.style.display = "inline-block";
            yInput.style.display = "inline-block";
        }
    }
    formDiv.appendChild(xInput);
    formDiv.appendChild(document.createTextNode(" / "));
    formDiv.appendChild(yInput);
    aggiornaVisibilita();

    tipoSelect.addEventListener("change", aggiornaVisibilita);

    // Pulsanti Salva / Annulla
    const btnSalva = document.createElement("button");
    btnSalva.innerText = "Salva";
    btnSalva.style.marginLeft = "8px";
    btnSalva.onclick = () => {
        let scontoObj;
        if (tipoSelect.value === "percentuale") {
            const v = parseFloat(percInput.value);
            if (isNaN(v) || v < 0) return notify("Inserisci una percentuale valida (>=0).", "warn");
            scontoObj = { tipo: "percentuale", valore: v };
        } 
        else if (tipoSelect.value === "x_paga_y") {
            const x = parseInt(xInput.value, 10);
            const y = parseInt(yInput.value, 10);
            if (isNaN(x) || isNaN(y) || x < 1 || y < 1) return notify("Inserisci X e Y validi (>=1).", "warn");
            if (y > x) return notify("In 'Prendi X Paga Y' Y non può essere maggiore di X.", "error");
            scontoObj = { tipo: "x_paga_y", valore: { x, y } };
        } 
        else if (tipoSelect.value === "x_paga_y_fisso") {
            const x = parseInt(xInput.value, 10);
            const y = parseFloat(yInput.value);
            if (isNaN(x) || isNaN(y) || x < 1 || y <= 0) return notify("Inserisci X e Y validi (>=1).", "warn");
            scontoObj = { tipo: "x_paga_y_fisso", valore: { x, y } };
        }
        db.ref("menu/" + id + "/sconto").set(scontoObj).then(() => {
            caricaScontiAdmin(); // ricarica la lista
        }).catch(err => { notify("Errore salvataggio: " + err.message, "error"); });
        formDiv.remove();
    };
    formDiv.appendChild(btnSalva);

    const btnAnnulla = document.createElement("button");
    btnAnnulla.innerText = "Annulla";
    btnAnnulla.style.marginLeft = "6px";
    btnAnnulla.onclick = () => formDiv.remove();
    formDiv.appendChild(btnAnnulla);

    // Inserisce il form sotto la riga del piatto
    containerRow.insertAdjacentElement('afterend', formDiv);

    formDiv.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
//invio comanda di ogni tipo in fondo per evitari errori
document.addEventListener("DOMContentLoaded", () => {
    const inviaBtn = document.getElementById("inviaComandaBtn");
    if (!inviaBtn) return; // sicurezza
    const noteInput = document.getElementById("noteComanda");

    inviaBtn.addEventListener("click", async () => {
        const num = numInput.value.trim();
        const lettera = letteraInput.value.trim().toUpperCase();

        if (!num || !lettera || !/^[A-Z]$/.test(lettera)) {
            notify("Inserisci numero e lettera della comanda validi!", "error");
            return;
        }

        const numeroComandaFinale = num + lettera;
        const piattiValidi = comandaCorrente.filter(p => p.quantita > 0);

        if (!piattiValidi.length) {
            notify("Inserisci almeno un piatto con quantità maggiore di 0!", "error");
            return;
        }
        // controllo duplicati (numero + lettera insieme)
        const existing = await db.ref("comande").orderByChild("numero").equalTo(numeroComandaFinale).once("value");
        if (existing.exists()) {
            notify("❌ Comanda " + numeroComandaFinale + " già presente! Non è possibile inviarne un'altra identica.", "error");
            return;
        }

        // ✅ prendi il valore delle note prima di svuotare il campo
        const note = noteInput.value.trim();
        // 🔹 Controllo: se il campo note è compilato, deve esserci almeno un tick attivo
        if (note && window.settings.noteDestinazioniAbilitate) {
            const tickCucina = document.getElementById("tickCucina");
            const tickBere = document.getElementById("tickBere");
            const tickSnack = document.getElementById("tickSnack");

            const cucinaSel = tickCucina && tickCucina.checked;
            const bereSel = tickBere && tickBere.checked;
            const snackSel = tickSnack && tickSnack.checked;

            if (!cucinaSel && !bereSel && !snackSel) {
                notify("⚠️ Hai scritto delle note, ma non hai selezionato nessuna destinazione! Seleziona almeno un profilo per inviarle.", "error");
                return; // blocca invio comanda
            }
        }

        try {
            inviaBtn.disabled = true;
            inviaBtn.innerText = "Invio in corso...";

            const richieste = calcolaRichiesteDaPiatti(piattiValidi);
            const res = await applicaDecrementiIngredienti(richieste);

            if (!res.success) {
                notify("Impossibile inviare comanda: " + (res.message || "errore ingredienti"), "error");
                return;
            }
            const orario = new Date().toLocaleTimeString("it-IT", { hour12: false });
            const ref = db.ref("comande").push();
            // ✅ controlla se il toggle Asporto è attivo e la casella spuntata
            const checkAsporto = document.getElementById("checkAsporto");
            let commentoAsporto = "";
            if (window.settings.asportoAbilitato && checkAsporto && checkAsporto.checked) {
                commentoAsporto = "ASPORTO";
            }
            const metodoPagamento = document.getElementById("metodoPagamento").value; // "contanti" o "pos"

            // ✅ invio comanda con il campo "commento"
            const note = noteInput.value.trim();
            let noteDestinazioni = [];

            if (window.settings.noteDestinazioniAbilitate) {
            if (document.getElementById("tickCucina").checked) noteDestinazioni.push("cucina");
            if (document.getElementById("tickBere").checked) noteDestinazioni.push("bere");
            const tickSnack = document.getElementById("tickSnack");
            if (tickSnack && tickSnack.checked) noteDestinazioni.push("snack");
            } else {
            // default classico: note a cucina e (se attivo) anche a snack
            noteDestinazioni = ["cucina"];
            if (window.settings.snackAbilitato) noteDestinazioni.push("snack");
            }

            // Crea l’oggetto comanda
            const nuovaComanda = {
                numero: numeroComandaFinale,
                piatti: piattiValidi,
                statoCucina: piattiValidi.some(i => i.categoria !== "bevande") ? "da fare" : "completato",
                statoBere: piattiValidi.some(i => i.categoria === "bevande") ? "da fare" : "completato",
                timestamp: Date.now(),
                orario: orario,
                note: note,
                noteDestinazioni: noteDestinazioni,
                commento: commentoAsporto || null, 
                metodoPagamento: metodoPagamento
            };

            // 🔹 Aggiungi statoSnack se lo snack è abilitato
            if (window.settings.snackAbilitato) {
                nuovaComanda.statoSnack = "da fare";
            }

            // Salva la comanda su Firebase
            await ref.set(nuovaComanda);


            const piattiDaStampare = [...comandaCorrente];
            const noteDaStampare = noteInput.value.trim();
            const numeroComandaDaStampare = numeroComandaFinale;
            // ✅ reset dopo l’invio
            comandaCorrente = [];
            aggiornaComandaCorrente();
            noteInput.value = ""; 
            numInput.value = "";
            letteraInput.value = "";
            totalePagato = 0;
            totalePagatoSpan.innerText = "0.00";
            restoDovutoSpan.innerText = "0.00";
            aggiornaSuggerimentoResto();
            // 🔹 Reset casella Asporto
            if (checkAsporto) checkAsporto.checked = false;

            // eventuale alert di conferma
            if(!window.settings.stampaAutomaticaComande) {
                notify("✅ Comanda " + numeroComandaFinale + " inviata con successo!", "info");
            } else if(window.settings.stampaAutomaticaComande) {
                notify("✅ Comanda " + numeroComandaFinale + " inviata con successo!, apertura schermata di stampa...", "info");
                if(window.settings.stampaAutomaticaComande) {
                    stampaComanda(piattiDaStampare, numeroComandaDaStampare, noteDaStampare);
                }
            }
        } catch (err) {
            console.error("Errore invio comanda:", err);
            notify("Errore invio comanda: " + (err.message || err), "error");
        } finally {
            inviaBtn.disabled = false;
            inviaBtn.innerText = "Invia Comanda";
            aggiornaStatoInvio();
        }
    });
});
// ----------------------- NOTIFY -----------------------
// --- funzione suono ---
function playDing() {
    if (!window.settings.suono) return;

    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();

        // Primo tono (alto)
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = "sine";
        osc1.frequency.value = 1046; // C6
        gain1.gain.setValueAtTime(0.2, ctx.currentTime);
        osc1.connect(gain1).connect(ctx.destination);
        osc1.start();
        osc1.stop(ctx.currentTime + 0.15);

        // Secondo tono (più basso, leggero ritardo)
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = "sine";
        osc2.frequency.value = 784; // G5
        gain2.gain.setValueAtTime(0.15, ctx.currentTime + 0.1);
        osc2.connect(gain2).connect(ctx.destination);
        osc2.start(ctx.currentTime + 0.1);
        osc2.stop(ctx.currentTime + 0.25);

        // Piccolo fade out per non essere brusco
        gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);

    } catch (e) {
        console.error("Audio non supportato:", e);
    }
}
function riproduciSuono(tipo) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();

        function suonaNota(freq, durata, delay = 0, volume = 0.15) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = "sine";
            osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
            gain.gain.setValueAtTime(volume, ctx.currentTime + delay);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + durata);
            osc.start(ctx.currentTime + delay);
            osc.stop(ctx.currentTime + delay + durata);
        }

        if (tipo === "blocco") {
            // sequenza più grave per “blocco”
            suonaNota(660, 0.15, 0);
            suonaNota(550, 0.15, 0.15);
            suonaNota(440, 0.2, 0.3);
        } else if (tipo === "sblocco") {
            // sequenza più acuta per “sblocco”
            suonaNota(440, 0.15, 0);
            suonaNota(550, 0.15, 0.15);
            suonaNota(660, 0.2, 0.3);
        } else {
            // fallback generico
            suonaNota(500, 0.2);
            suonaNota(600, 0.2, 0.2);
        }
    } catch (err) {
        console.warn("Errore suono:", err);
    }
}
function riproduciSuonoNotifica() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();

        function suona(freq, durata, delay = 0, volume = 0.2) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "triangle"; 
            osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
            gain.gain.setValueAtTime(volume, ctx.currentTime + delay);
            gain.connect(ctx.destination);
            osc.connect(gain);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + durata);
            osc.start(ctx.currentTime + delay);
            osc.stop(ctx.currentTime + delay + durata);
        }

        // sequenza breve e riconoscibile come notifica
        const sequenza = [
            { freq: 1046, dur: 0.12, delay: 0 },
            { freq: 1318, dur: 0.14, delay: 0.1 },
            { freq: 1568, dur: 0.16, delay: 0.22 },
            { freq: 1318, dur: 0.12, delay: 0.38 } // ritorno leggero
        ];

        sequenza.forEach(nota => suona(nota.freq, nota.dur, nota.delay, 0.2));

    } catch (e) {
        console.warn("Impossibile riprodurre suono:", e);
    }
}

// ------------------- NOTIFY (toast informativi) -------------------
function notify(msg, type = "info") {
    const div = document.createElement("div");
    div.className = `toast ${type}`;

    Object.assign(div.style, {
        position: "fixed",
        zIndex: 9999,
        padding: "16px 20px",
        borderRadius: "10px",
        boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
        fontWeight: "600",
        maxWidth: "400px",
        wordBreak: "break-word",
        textAlign: "center",
        opacity: "0",
        transition: "opacity 0.3s, transform 0.3s"
    });

    // Contenitore messaggio
    const msgDiv = document.createElement("div");
    msgDiv.innerText = msg;
    div.appendChild(msgDiv);

    switch (type) {
        case "info":
            Object.assign(div.style, {
                bottom: "20px",
                right: "20px",
                left: "auto",
                background: "#2196f3",
                color: "#fff"
            });
            break;

        case "warn":
        case "attenzione":
            Object.assign(div.style, {
                top: "20px",
                left: "50%",
                transform: "translateX(-50%)",
                background: "#ff9800",
                color: "#000"
            });
            break;

        case "error":
        case "critico":
            Object.assign(div.style, {
                top: "20px",
                left: "50%",
                transform: "translateX(-50%)",
                background: "#f44336",
                color: "#fff"
            });
            break;

        default:
            Object.assign(div.style, {
                bottom: "20px",
                right: "20px",
                background: "#2196f3",
                color: "#fff"
            });
            break;
    }

    document.body.appendChild(div);
    requestAnimationFrame(() => div.style.opacity = "1");

    // Rimozione automatica
    setTimeout(() => {
        div.style.opacity = "0";
        setTimeout(() => div.remove(), 500);
    }, 4000);

    // Suoni dedicati
    if (window.settings?.suonoCassa) {
        try {
            if (type === "critico") playCritico();
            else if (type === "attenzione") playAttenzione();
        } catch (e) { console.warn("Audio non supportato:", e); }
    }
}
function playCritico() {
    if (!window.settings.suonoCassa) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();

        function suona(freq, delay, durata, volume) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "square"; // tono deciso
            osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
            gain.gain.setValueAtTime(volume, ctx.currentTime + delay);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + durata);
            osc.connect(gain).connect(ctx.destination);
            osc.start(ctx.currentTime + delay);
            osc.stop(ctx.currentTime + delay + durata);
        }

        // Sequenza discendente rapida: senso “allarme critico”
        const sequenza = [
            { freq: 440, dur: 0.2, delay: 0, vol: 0.25 }, // A4
            { freq: 392, dur: 0.2, delay: 0.2, vol: 0.22 }, // G4
            { freq: 330, dur: 0.25, delay: 0.4, vol: 0.2 }  // E4 basso
        ];

        sequenza.forEach(nota => suona(nota.freq, nota.delay, nota.dur, nota.vol));

    } catch (e) {
        console.warn("Audio non supportato:", e);
    }
}
function playAttenzione() {
    if (!window.settings.suonoCassa) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();

        function suona(freq, delay, durata, volume) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "triangle"; // tono più morbido
            osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
            gain.gain.setValueAtTime(volume, ctx.currentTime + delay);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + durata);
            osc.connect(gain).connect(ctx.destination);
            osc.start(ctx.currentTime + delay);
            osc.stop(ctx.currentTime + delay + durata);
        }

        // Sequenza breve e acuta: senso “attenzione”
        const sequenza = [
            { freq: 554, dur: 0.15, delay: 0, vol: 0.2 }, // C#5
            { freq: 622, dur: 0.15, delay: 0.15, vol: 0.18 }, // D#5
            { freq: 740, dur: 0.18, delay: 0.3, vol: 0.16 } // F#5
        ];

        sequenza.forEach(nota => suona(nota.freq, nota.delay, nota.dur, nota.vol));

    } catch (e) {
        console.warn("Audio non supportato:", e);
    }
}
// ------------------- QUESTION (messaggi con pulsanti) -------------------
function question(msg, options = {}) {
    const div = document.createElement("div");
    div.className = "toast question";

    Object.assign(div.style, {
        position: "fixed",
        top: "20px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        padding: "16px 24px",
        borderRadius: "10px",
        boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
        fontWeight: "600",
        maxWidth: "400px",
        wordBreak: "break-word",
        textAlign: "center",
        background: "#2196f3",
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "16px",
        opacity: "0",
        transition: "opacity 0.3s, transform 0.3s"
    });

    // Messaggio
    const msgDiv = document.createElement("div");
    msgDiv.innerText = msg;
    div.appendChild(msgDiv);

    // Container pulsanti
    const btnContainer = document.createElement("div");
    btnContainer.style.display = "flex";
    btnContainer.style.justifyContent = "center";
    btnContainer.style.gap = "12px";
    btnContainer.style.width = "100%";

    // Conferma
    if (options.confirmText) {
        const btnConfirm = document.createElement("button");
        btnConfirm.innerText = options.confirmText;
        Object.assign(btnConfirm.style, {
            padding: "8px 16px",
            borderRadius: "6px",
            border: "none",
            cursor: "pointer",
            fontWeight: "bold",
            background: "#fff",
            color: "#2196f3"
        });
        btnConfirm.onclick = () => {
            div.remove();
            if (typeof options.onConfirm === "function") options.onConfirm();
        };
        btnContainer.appendChild(btnConfirm);
    }

    // Annulla
    if (options.cancelText) {
        const btnCancel = document.createElement("button");
        btnCancel.innerText = options.cancelText;
        Object.assign(btnCancel.style, {
            padding: "8px 16px",
            borderRadius: "6px",
            border: "none",
            cursor: "pointer",
            fontWeight: "bold",
            background: "#f44336",
            color: "#fff"
        });
        btnCancel.onclick = () => {
            div.remove();
            if (typeof options.onCancel === "function") options.onCancel();
        };
        btnContainer.appendChild(btnCancel);
    }

    div.appendChild(btnContainer);
    document.body.appendChild(div);
    requestAnimationFrame(() => div.style.opacity = "1");
}
// ----------------------- DISONOTIFY -----------------------
function disonotify(msg, options = {}) {
    // overlay
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        backgroundColor: "rgba(0,0,0,0.5)",
        zIndex: 9998,
    });
    document.body.appendChild(overlay);

    // div centrale
    const div = document.createElement("div");
    div.style.position = "fixed";
    div.style.top = "50%";
    div.style.left = "50%";
    div.style.transform = "translate(-50%, -50%)";
    div.style.background = "#2196f3";
    div.style.color = "#fff";
    div.style.padding = "24px";
    div.style.borderRadius = "8px";
    div.style.display = "flex";
    div.style.flexDirection = "column";
    div.style.alignItems = "center";
    div.style.justifyContent = "center";
    div.style.gap = "16px";
    div.style.maxWidth = "400px";
    div.style.zIndex = 9999;

    // messaggio
    const msgDiv = document.createElement("div");
    msgDiv.innerText = msg;
    div.appendChild(msgDiv);

    // bottone conferma
    const btnConfirm = document.createElement("button");
    btnConfirm.innerText = options.confirmText || "OK";
    Object.assign(btnConfirm.style, {
        padding: "8px 16px",
        minWidth: "100px",
        border: "none",
        borderRadius: "6px",
        cursor: "pointer",
        fontWeight: "bold",
        background: "#fff",
        color: "#2196f3"
    });
    btnConfirm.onclick = async () => {
        overlay.remove();
        div.remove();
        if (typeof options.onConfirm === "function") await options.onConfirm();
    };
    div.appendChild(btnConfirm);

    // bottone annulla opzionale
    if (options.showCancel) {
        const btnCancel = document.createElement("button");
        btnCancel.innerText = options.cancelText || "Annulla";
        Object.assign(btnCancel.style, {
            padding: "8px 16px",
            minWidth: "100px",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontWeight: "bold",
            background: "#f44336",
            color: "#fff",
            marginTop: "8px"
        });
        btnCancel.onclick = async () => {
            overlay.remove();
            div.remove();
            if (typeof options.onCancel === "function") await options.onCancel();
        };
        div.appendChild(btnCancel);
    }

    document.body.appendChild(div);
}
// ---------- Backup Database ----------
backupDbBtn.onclick = async () => {
    if (!checkOnline(true)) return;
    try {
        const [comandeSnap, utentiSnap, ingredientiSnap, menuSnap, impostazioniSnap] = await Promise.all([
            db.ref("comande").once("value"),
            db.ref("utenti").once("value"),
            db.ref("ingredienti").once("value"),
            db.ref("menu").once("value"),
            db.ref("impostazioni").once("value")
        ]);

        const data = {
            comande: comandeSnap.val() || {},
            utenti: utentiSnap.val() || {},
            ingredienti: ingredientiSnap.val() || {},
            menu: menuSnap.val() || {},
            impostazioni: impostazioniSnap.val() || {}
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "backup_comande.json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        notify("Backup scaricato correttamente!","info");
    } catch(e) {
        notify("Errore nel backup: " + e.message, "error");
    }
};
// ---------- Ripristina backup ----------
restoreDbBtn.onclick = () => restoreDbFile.click();
restoreDbFile.addEventListener("change", async function() {
    if (!checkOnline(true)) return;
    const file = this.files[0];
    if (!file) return;
    try {
        const text = await file.text();
        const jsonData = JSON.parse(text);

        // Scrive solo i nodi esistenti nel backup
        const promises = [];
        for (const nodo in jsonData) {
            promises.push(db.ref(nodo).set(jsonData[nodo]));
        }
        await Promise.all(promises);

        notify("Database ripristinato correttamente!", "info");
    } catch(e) {
        notify("Errore nel ripristino: " + e.message, "error");
    }
});
//RICERCA
function initRicercaComande(containerId, inputId) {
    if (!checkOnline(true)) return;
    const container = document.getElementById(containerId);
    const input = document.getElementById(inputId);

    if (!container || !input) return;

    let debounceTimer;

    function applyFilter() {
        const val = input.value.trim().toUpperCase();
        
        // requestAnimationFrame evita di bloccare l'interfaccia durante il filtraggio
        requestAnimationFrame(() => {
            container.querySelectorAll(".order").forEach(orderDiv => {
                const numero = orderDiv.dataset.numero?.toUpperCase() || "";
                // Cerca anche nel testo interno (es. nome cliente o note) se la ricerca è > 2 caratteri
                const textContent = orderDiv.innerText.toUpperCase();
                
                if (numero.includes(val) || (val.length > 2 && textContent.includes(val))) {
                    orderDiv.style.display = "";
                } else {
                    orderDiv.style.display = "none";
                }
            });
        });
    }

    // Event listener ottimizzato (Debounce)
    input.addEventListener("input", () => {
        clearTimeout(debounceTimer);
        // Aspetta 300ms che l'utente finisca di scrivere
        debounceTimer = setTimeout(applyFilter, 300);
    });

    // Mantiene la compatibilità per il filtro automatico all'arrivo di nuovi ordini
    container.filterCurrentOrders = applyFilter;
}
async function stampaComanda(items, numeroComanda, note = "") {
    if (!items || items.length === 0) return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a6", orientation: "portrait" });

    const ora = new Date();
    const orario = ora.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    // --- Divisione per categoria ---
    const categorie = { cibi: [], bevande: [], snack: [] };
    items.forEach(i => {
        const cat = (i.categoria || "").toLowerCase();
        if (cat === "cibi") categorie.cibi.push(i);
        else if (cat === "bevande") categorie.bevande.push(i);
        else if (cat === "snack") categorie.snack.push(i);
    });

    let pagina = 0;
    for (const [cat, piatti] of Object.entries(categorie)) {
        if (piatti.length === 0) continue;
        if (pagina > 0) doc.addPage();
        pagina++;

        const titolo = cat === "cibi" ? "CIBO" : cat === "bevande" ? "BEVANDE" : "SNACK";
        let y = 10;
        // ✅ Scritta in cima centrata
        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        const pageWidth = doc.internal.pageSize.getWidth();
        const nomeStand = cliente.nomeStand || window.settings.nomeStand || "BistroBò";
        doc.text(nomeStand, pageWidth / 2, y, { align: "center" });
        y += 10; // spazio sotto il titolo
        doc.setFontSize(12);
        doc.text(`NUMERO COMANDA: ${numeroComanda}`, 10, y); y += 6;
        doc.text(`ORARIO: ${orario}`, 10, y); y += 8;
        doc.text(`${titolo}:`, 10, y); y += 6;
        doc.setFontSize(10);
        piatti.forEach(p => {
            doc.text(`  ${p.quantita}x ${p.nome} - €${calcolaPrezzoConSconto(p).toFixed(2)}`, 10, y);
            y += 5;
        });
        if (note) {
            y += 3;
            doc.text(`NOTE: ${note}`, 10, y);
        }
    }
    // --- Browser normale ---
    const pdfBase64 = doc.output("datauristring");
    const newWindow = window.open("", "_blank");
    newWindow.document.write(`
        <html><head><title>Comanda ${numeroComanda}</title></head>
        <body style="margin:0">
            <iframe src="${pdfBase64}" style="border:none;width:100%;height:100vh;"></iframe>
            <script>
                window.onload = () => {
                    const iframe = document.querySelector('iframe');
                    iframe.onload = () => setTimeout(() => iframe.contentWindow.print(), 300);
                };
            </script>
        </body></html>
    `);
    newWindow.document.close();
}
//OROLOGIO
async function inizializzaOrologio() {
    try {
        // Prende offset dal server Firebase
        const offsetSnap = await db.ref(".info/serverTimeOffset").once("value");
        const offset = offsetSnap.val() || 0;

        // timestamp UTC in ms
        timestampServerUTC = Date.now() + offset;

        avvioLocale = Date.now();

        setInterval(aggiornaOrologio, 1000);
        aggiornaOrologio();
    } catch (err) {
        console.error("Errore inizializzazione orologio:", err);
    }
}
function aggiornaOrologio() {
    if (timestampServerUTC === null || avvioLocale === null) return;
    const span = document.getElementById("orologio");
    if (!span) return;

    // Millisecondi trascorsi dall'avvio
    const delta = Date.now() - avvioLocale;

    // Ora UTC aggiornata
    const oraUTC = new Date(timestampServerUTC + delta);

    // Applica fuso orario Italia (UTC+1/+2 ora legale)
    const hh = oraUTC.toLocaleString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Europe/Rome" }).split(':')[0];
    const mm = oraUTC.toLocaleString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Europe/Rome" }).split(':')[1];
    const ss = oraUTC.toLocaleString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Europe/Rome" }).split(':')[2];

    span.innerText = `${hh}:${mm}:${ss}`;
}
//Tema
const temiDisponibili = ["default", "scout", "autunno", "inverno", "primavera", "estate"];
function aggiornaTema(tema, salvaSuFirebase = false) {
  // 🔹 Rimuove tutte le classi dei temi
  document.body.classList.remove(
    "tema-default", "tema-scout", "tema-autunno",
    "tema-inverno", "tema-primavera", "tema-estate"
  );

  // 🔹 Aggiunge il tema selezionato
  document.body.classList.add("tema-" + tema);

  // 🔹 Solo l’admin autenticato salva su Firebase
    if (salvaSuFirebase) {
    const user = firebase.auth().currentUser;
    if (user) {
        db.ref("impostazioni/tema").set(tema)
        .then(() => console.log("✅ Tema salvato globalmente:", tema))
        .catch(err => console.warn("❌ Errore salvataggio tema globale:", err));
    } else {
        console.warn("⚠️ Tema non salvato: nessun utente autenticato.");
    }
    }

}
document.addEventListener("DOMContentLoaded", () => {
  const selectTema = document.getElementById("selectTema");
  const temaRef = db.ref("impostazioni/tema");

  // 🔹 1️⃣ Applica subito il tema salvato su Firebase
    temaRef.once("value").then(snap => {
    const temaIniziale = snap.exists() ? snap.val() : "default";
    aggiornaTema(temaIniziale);

    // IMPORTANTE: mostra la pagina solo dopo aver applicato il tema
    document.body.classList.add("tema-caricato");

    if (selectTema) selectTema.value = temaIniziale;
    });


  // 🔹 2️⃣ Rimane in ascolto di eventuali cambi dal database (sincronizzazione live)
    temaRef.on("value", snap => {
        const temaCorrente = snap.exists() ? snap.val() : "default";
        aggiornaTema(temaCorrente);

        // Aggiungi classe solo se non già presente
        if (!document.body.classList.contains("tema-caricato")) {
            document.body.classList.add("tema-caricato");
        }

        if (selectTema && selectTema.value !== temaCorrente) {
        selectTema.value = temaCorrente;
        }
    });


  // 🔹 3️⃣ Se l’admin cambia tema manualmente
  if (selectTema) {
    selectTema.addEventListener("change", () => {
      const nuovoTema = selectTema.value;
      aggiornaTema(nuovoTema, true); // salva solo se admin loggato
    });
  }
});
// ================= TEMPO MEDIO ATTESA =================

// Funzione intelligente per aggiornare lo stato e salvare il timestamp di fine preparazione cibo
async function aggiornaStatoConTermine(id, chiaveStato, nuovoStato) {
    if (!checkOnline(true)) return;

    try {
        const snap = await db.ref("comande/" + id).once("value");
        const c = snap.val();
        if (!c) return;

        const updateData = { [chiaveStato]: nuovoStato };
        
        // Verifica Snack abilitato
        let snackAbilitato = false;
        try {
            const s = await db.ref("impostazioni/snackAbilitato").once("value");
            snackAbilitato = s.val() === true;
        } catch(e) {}

        // Logica per determinare se la comanda è "Finita" lato Cibo (Cucina + Snack)
        // Se stiamo aggiornando Cucina o Snack, dobbiamo controllare l'altro reparto.
        // Ignoriamo "Bere" per il calcolo del tempo medio cibo.

        let cucinaOk = false;
        let snackOk = false;

        // Determina stato futuro Cucina
        if (chiaveStato === "statoCucina") cucinaOk = (nuovoStato === "completato");
        else cucinaOk = (c.statoCucina === "completato");

        // Determina stato futuro Snack
        if (snackAbilitato) {
            // Se il campo statoSnack non esiste (vecchie comande o senza snack), consideralo completato ai fini del calcolo
            // Ma se esiste, deve essere "completato"
            if (chiaveStato === "statoSnack") snackOk = (nuovoStato === "completato");
            else snackOk = (c.statoSnack === "completato" || !c.statoSnack); 
        } else {
            snackOk = true; // Se snack disabilitato, è sempre ok
        }

        // SE tutto il cibo è pronto, salviamo timestampTermine
        // MA SOLO se la comanda aveva effettivamente cibo (statoCucina diverso da completato all'inizio o simili)
        // Per semplicità: Se Cucina e Snack sono ok -> TERMINE.
        if (cucinaOk && snackOk) {
            updateData.timestampTermine = Date.now();
        } else {
            // Se riapriamo una comanda (da completato a da fare), rimuoviamo il termine
            updateData.timestampTermine = null;
        }

        await db.ref("comande/" + id).update(updateData);

    } catch (err) {
        console.error("Errore aggiornamento stato con termine:", err);
        notify("Errore aggiornamento stato", "error");
    }
}

// Funzione di calcolo e visualizzazione media
function calcolaEVisualizzaTempoMedio(comandeSnapshot) {
    const boxCassa = document.getElementById("boxTempoMedioCassa");
    const valCassa = document.getElementById("valoreTempoMedioCassa");
    const boxAdmin = document.getElementById("boxTempoMedioAdmin");
    const valAdmin = document.getElementById("valoreTempoMedioAdmin");

    if (!comandeSnapshot.exists()) {
        if(boxCassa) boxCassa.style.display = "none";
        if(boxAdmin) boxAdmin.style.display = "none";
        return;
    }

    const comandeConTermine = [];

    comandeSnapshot.forEach(s => {
        const c = s.val();
        // Consideriamo solo comande che hanno un timestampTermine e un timestamp creazione
        // E che non sono SOLO bere (ovvero avevano cibo da preparare)
        // Controllo semplice: se timestampTermine esiste, significa che è passata dalla logica "Cibo Pronto".
        if (c.timestamp && c.timestampTermine) {
            const durata = c.timestampTermine - c.timestamp;
            // Filtro errori dati (durata negativa o assurda) e comande istantanee (es. solo bere che nascono completate)
            // Se durata < 30 secondi, probabilmente era solo bere o pre-completata. La ignoriamo per la media "Cucina".
            if (durata > 30000) { 
                comandeConTermine.push(durata);
            }
        }
    });

    // Se non ci sono dati sufficienti
    if (comandeConTermine.length === 0) {
        if(boxCassa) boxCassa.style.display = "none";
        if(boxAdmin) boxAdmin.style.display = "none";
        return;
    }

    // Ordina: le ultime completate (in realtà qui ho solo le durate, ma sto iterando su tutte. 
    // Per precisione "Ultime 10 comande":
    // Dovrei ordinare l'array originale per timestampTermine decrescente.
    // Rifacciamo il loop per prendere gli oggetti completi.
    
    const listaCompleta = [];
    comandeSnapshot.forEach(s => {
        const c = s.val();
        if (c.timestamp && c.timestampTermine) {
            listaCompleta.push(c);
        }
    });

    // Ordina per data di completamento (più recenti prima)
    listaCompleta.sort((a, b) => b.timestampTermine - a.timestampTermine);

    // Prendi le prime 10
    const ultime10 = listaCompleta.slice(0, 10);
    
    if (ultime10.length === 0) return;

    let somma = 0;
    let conteggio = 0;

    ultime10.forEach(c => {
        const durata = c.timestampTermine - c.timestamp;
        if (durata > 30000) { // filtro 30 secondi
            somma += durata;
            conteggio++;
        }
    });

    if (conteggio === 0) {
        if(boxCassa) boxCassa.style.display = "none";
        if(boxAdmin) boxAdmin.style.display = "none";
        return;
    }

    const mediaMs = somma / conteggio;
    const mediaMin = Math.round(mediaMs / 60000);

    // Aggiorna UI
    if (boxCassa && window.isLoggedInCassa) {
        boxCassa.style.display = "block";
        valCassa.innerText = mediaMin;
    }
    if (boxAdmin && window.isLoggedInAdmin) {
        boxAdmin.style.display = "block";
        valAdmin.innerText = mediaMin;
    }
}
// -------------------- TABS --------------------
document.querySelectorAll(".tabBtn").forEach(b=>{
    b.addEventListener("click",()=>{
        document.querySelectorAll(".tabContent").forEach(t=>t.classList.remove("active"));
        const tab=document.getElementById(b.dataset.tab);
        tab.classList.add("active");
        
        if(b.dataset.tab === "ingredientiTab") caricaIngredienti();
        if(b.dataset.tab === "menuTab") caricaMenuAdmin();
        if(b.dataset.tab === "utentiTab") caricaUtenti();
        if(b.dataset.tab === "incassiTab") caricaStatistiche();
        if(b.dataset.tab === "comandeTab") caricaGestioneComandeAdmin();
        if(b.dataset.tab === "scontiTab") caricaScontiAdmin();
    });
});
// tabs interne Cassa
document.querySelectorAll("#cassaDiv .tabBtn").forEach(b=>{
    b.addEventListener("click", ()=>{
        document.querySelectorAll("#cassaDiv .tabContent").forEach(t=>t.classList.remove("active"));
        document.getElementById(b.dataset.tab).classList.add("active");
    });
});
// attiva di default "Aggiungi Comanda"
document.getElementById("aggiungiComandaTab").classList.add("active");