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
	nomeStand: "BistroBò",
	displayClienteAbilitato: false,
	comandeProgressive: false,
	contatoreComande: 0,
	letteraComandaAbilitata: true,
	selettoreQuantitaCassa: true,
	gestioneSoldiCassa: true,
	cassaOttimizzata: false,
	magazzinoCucina: true,
	magazzinoBere: true,
	magazzinoSnack: true,
	menuCucina: true,
	menuBere: true,
	menuSnack: true,
	sistemaExtraAbilitato: true,
    scontriniSeparati: false,
    piattiComboAbilitati: false
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
// --- RECUPERO PASSWORD (CON GRAFICA BISTROBO) ---
const forgotPasswordBtn = document.getElementById("forgotPasswordBtn");
const forgotPasswordDiv = document.getElementById("forgotPasswordDiv");
const tornaLoginDaResetBtn = document.getElementById("tornaLoginDaResetBtn");
const sendResetBtn = document.getElementById("sendResetBtn");
const forgotEmail = document.getElementById("forgotEmail");
const forgotMsg = document.getElementById("forgotMsg");

// 1. Mostra schermata recupero quando si clicca "Hai dimenticato la password?"
if (forgotPasswordBtn) {
    forgotPasswordBtn.addEventListener("click", (e) => {
        e.preventDefault();
        loginDiv.classList.add("hidden");
        forgotPasswordDiv.classList.remove("hidden");
        
        // Chicca: se aveva già scritto l'email nel login, gliela compiliamo in automatico
        const emailGiaScritta = document.getElementById("username").value.trim();
        if (emailGiaScritta) forgotEmail.value = emailGiaScritta;
        
        forgotMsg.innerText = ""; // Pulisce messaggi precedenti
    });
}

// 2. Torna al login annullando
if (tornaLoginDaResetBtn) {
    tornaLoginDaResetBtn.addEventListener("click", () => {
        forgotPasswordDiv.classList.add("hidden");
        loginDiv.classList.remove("hidden");
        forgotEmail.value = "";
    });
}

// 3. Invia la mail
if (sendResetBtn) {
    sendResetBtn.addEventListener("click", async () => {
        const emailValue = forgotEmail.value.trim();
        
        if (!emailValue) {
            forgotMsg.style.color = "red";
            forgotMsg.innerText = "❌ Inserisci un'email valida.";
            return;
        }

        try {
            sendResetBtn.disabled = true;
            sendResetBtn.innerText = "Invio in corso...";
            
            // Invio mail nativa Firebase
            await auth.sendPasswordResetEmail(emailValue);
            
            forgotMsg.style.color = "green";
            forgotMsg.innerHTML = "✅ Email inviata con successo!<br><span style='font-size:0.85em; color:gray;'>Controlla la posta (anche nello Spam).</span>";
            
            sendResetBtn.disabled = false;
            sendResetBtn.innerText = "Invia Email";
            
        } catch (error) {
            console.error("Errore reset password:", error);
            forgotMsg.style.color = "red";
            
            if (error.code === 'auth/user-not-found') {
                forgotMsg.innerText = "❌ Nessun account trovato con questa email.";
            } else if (error.code === 'auth/invalid-email') {
                forgotMsg.innerText = "❌ Formato email non valido.";
            } else {
                forgotMsg.innerText = "❌ Errore: " + error.message;
            }
            
            sendResetBtn.disabled = false;
            sendResetBtn.innerText = "Invia Email";
        }
    });
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
        // 1. Crea account Firebase
        const res = await auth.createUserWithEmailAndPassword(email, password);
		
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

        // 2. Generiamo un Token Segreto e salviamo l'utente
        const tokenSegreto = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

        await db.ref("utenti/" + res.user.uid).set({
            username: email,
            ruolo: ruoloUtente,
            approvato: approvAuto,
            attivo: true,
            email_verificata: false,
            token_verifica: tokenSegreto // <--- SALVIAMO IL TOKEN SEGRETO
        });

        // 3. Invia l'email personalizzata tramite EmailJS includendo il Token nel link
        const linkMagico = `https://bolgino.github.io/BistroBo-App/verifica.html?uid=${res.user.uid}&token=${tokenSegreto}`;
        
        const templateParams = {
            to_email: email,
            link_verifica: linkMagico
        };

        emailjs.send("service_eao9r7j", "template_45c9nal", templateParams, "NaeWRUYCDcaApeOXd")
        .then((response) => {
            console.log("✅ Email inviata con successo!", response.status, response.text);
        })
        .catch((err) => {
            console.error("❌ ERRORE EMAILJS DETTAGLIATO:", err);
            alert("Errore nell'invio della mail: " + (err.text || "Controlla la console."));
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
    // MANUTENZIONE
    if (!checkOnline(true)) return;
    const toggleManutenzioneBtn = document.getElementById("toggleManutenzioneBtn");
    const manutenzioneRef = db.ref("impostazioni/manutenzione");
    if (toggleManutenzioneBtn) {
        initToggle(toggleManutenzioneBtn, manutenzioneRef, {on: "ATTIVA ⛔", off: "OFF"}, false, val => {
            window.settings.manutenzione = val;
        });
    }

    // APPROVAZIONE AUTOMATICA
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
	// ================= COMANDE PROGRESSIVE =================
    const toggleComandeProgressiveBtn = document.getElementById("toggleComandeProgressiveBtn");
    const comandeProgressiveRef = db.ref("impostazioni/comandeProgressive");
    const settingResetContatore = document.getElementById("settingResetContatore");

    if (toggleComandeProgressiveBtn) {
        initToggle(toggleComandeProgressiveBtn, comandeProgressiveRef, {on: "ON", off: "OFF"}, false, val => {
            window.settings.comandeProgressive = val;
            
            // Mostra o nascondi il tasto Reset Contatore
            if (settingResetContatore) {
                settingResetContatore.style.display = val ? "flex" : "none";
            }

            // Aggiorna la grafica dell'input numero in Cassa
            const numInput = document.getElementById("numComanda");
            if (numInput) {
                if (val) {
                    numInput.value = "";
                    numInput.placeholder = "Auto";
                    numInput.disabled = true;
                    numInput.style.backgroundColor = "#e0e0e0";
                } else {
                    numInput.placeholder = "";
                    numInput.disabled = false;
                    numInput.style.backgroundColor = "";
                }
                aggiornaStatoInvio(); // Forza l'aggiornamento del bottone invio
            }
        });
    }
    // ================= RESET CONTATORE PROGRESSIVO =================
    const resetContatoreBtn = document.getElementById("resetContatoreBtn");
    if (resetContatoreBtn) {
        resetContatoreBtn.onclick = () => {
            if (!checkOnline(true)) return;
            disonotify("⚠️ Vuoi davvero azzerare il contatore delle comande? La prossima ripartirà da 1.", {
                confirmText: "Azzera",
                showCancel: true,
                cancelText: "Annulla",
                onConfirm: async () => {
                    try {
                        await db.ref("impostazioni/contatoreComande").set(0);
                        notify("✅ Contatore azzerato con successo!", "info");
                    } catch (err) {
                        notify("❌ Errore durante l'azzeramento: " + err.message, "error");
                    }
                }
            });
        };
    }
	// ================= LETTERA COMANDA ABILITATA =================
    const toggleLetteraComandaBtn = document.getElementById("toggleLetteraComandaBtn");
    const letteraComandaRef = db.ref("impostazioni/letteraComandaAbilitata");

    if (toggleLetteraComandaBtn) {
        initToggle(toggleLetteraComandaBtn, letteraComandaRef, {on: "ON", off: "OFF"}, true, val => {
            window.settings.letteraComandaAbilitata = val;
            
            // Mostra o nascondi la casella di input della lettera in Cassa
            const letteraInput = document.getElementById("letteraComanda");
            const labelNumeroLettera = document.getElementById("labelNumeroLettera"); // <--- Aggiunto
            
            if (letteraInput) {
                letteraInput.style.display = val ? "inline-block" : "none";
                if (!val) letteraInput.value = ""; // Svuota la lettera se la nascondiamo
            }
            
            // <--- Aggiunto questo blocco che cambia la scritta
            if (labelNumeroLettera) {
                labelNumeroLettera.innerText = val ? "Numero e Lettera Comanda:" : "Numero Comanda:";
            }
            
            // Forza l'aggiornamento del pulsante di invio
            if (typeof aggiornaStatoInvio === "function") aggiornaStatoInvio(); 
        });
    }
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
	// TOGGLE DISPLAY CLIENTE
	const toggleDisplayClienteBtn = document.getElementById("toggleDisplayClienteBtn");
	const displayClienteRef = db.ref("impostazioni/displayClienteAbilitato");
	initToggle(toggleDisplayClienteBtn, displayClienteRef, {on: "ON", off: "OFF"}, false, val => {
	    window.settings.displayClienteAbilitato = val;
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
                        await db.ref("impostazioni/contatoreComande").set(0); 
                        // 🔹 AZZERA IL FONDO CASSA A FINE SERATA
                        await db.ref("impostazioni/fondoCassa").remove(); 
                        
                        notify("✅ Tutte le comande sono state eliminate e il fondo cassa azzerato!", "info");

                        const listaComandeAdmin = document.getElementById("listaComandeAdmin");
                        if (listaComandeAdmin) listaComandeAdmin.innerHTML = "";
                    } catch (err) {
                        console.error(err);
                        notify("❌ Errore durante l'eliminazione: " + err.message, "error");
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

    // 🔹 TOGGLE IMPOSTAZIONI DIPENDENTI DA SNACK
    const toggleNuoveInAltoSnackBtn = document.getElementById("toggleNuoveInAltoSnackBtn");
    const snackDependentSettings = document.getElementById("snackDependentSettings");
    const nuoveInAltoSnackRef = db.ref("impostazioni/nuoveInAltoSnack");

    // Funzione per mostrare/nascondere il blocco in Admin
    function aggiornaVisibilitaToggleSnack() {
        if (!snackDependentSettings) return;
        snackDependentSettings.style.display = window.settings.snackAbilitato ? "block" : "none";
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
	// ================= SELETTORE QUANTITÀ CASSA =================
    const toggleSelettoreQuantitaBtn = document.getElementById("toggleSelettoreQuantitaBtn");
    const selettoreQuantitaRef = db.ref("impostazioni/selettoreQuantitaCassa");

    if (toggleSelettoreQuantitaBtn) {
        initToggle(toggleSelettoreQuantitaBtn, selettoreQuantitaRef, {on: "ON", off: "OFF"}, true, val => {
            window.settings.selettoreQuantitaCassa = val;
            
            // Cerca il contenitore della quantità in cassa per nasconderlo/mostrarlo
            const divQuantita = document.getElementById("quantitaContainer");
            if (divQuantita) {
                divQuantita.style.display = val ? "inline-block" : "none";
            }
            
            // Se disattivato, resettiamo il valore a 1 per evitare bug
            const quantitaInput = document.getElementById("quantita");
            if (!val && quantitaInput) quantitaInput.value = 1;
        });
    }
	// ================= GESTIONE RESTO E SOLDI CASSA =================
	const toggleGestioneSoldiBtn = document.getElementById("toggleGestioneSoldiBtn");
	const gestioneSoldiRef = db.ref("impostazioni/gestioneSoldiCassa");
	
	if (toggleGestioneSoldiBtn) {
	    initToggle(toggleGestioneSoldiBtn, gestioneSoldiRef, {on: "ON", off: "OFF"}, true, val => {
	        window.settings.gestioneSoldiCassa = val;
	        
	        // Prendiamo i due blocchi che abbiamo creato in HTML
	        const rigaResto = document.getElementById("rigaRestoPagato");
	        const pannelloSoldi = document.getElementById("pannelloSoldiDestra");
	        
	        // Li mostriamo o li nascondiamo in base al toggle
	        if (rigaResto) rigaResto.style.display = val ? "" : "none";
	        if (pannelloSoldi) pannelloSoldi.style.display = val ? "" : "none";
	        
	        // Se viene spento, clicchiamo automaticamente su "Reset Soldi" in modo da azzerare calcoli pendenti
	        if (!val) {
	            const btnReset = document.getElementById("resetSoldiBtn");
	            if (btnReset) btnReset.click();
	        }
	    });
	}
	// ================= CASSA OTTIMIZZATA =================
    const toggleCassaOttBtn = document.getElementById("toggleCassaOttBtn");
    const cassaOttRef = db.ref("impostazioni/cassaOttimizzata");
    if (toggleCassaOttBtn) {
        initToggle(toggleCassaOttBtn, cassaOttRef, {on: "ON", off: "OFF"}, false, val => {
            window.settings.cassaOttimizzata = val;
            
            // Applica o rimuove la classe istantaneamente senza far sparire i bottoni!
            const cassaContainer = document.getElementById("aggiungiComandaTab");
            if (cassaContainer) {
                if (val) cassaContainer.classList.add("cassa-ottimizzata");
                else cassaContainer.classList.remove("cassa-ottimizzata");
            }
        });
    }
	// ================= VISIBILITÀ TAB INGREDIENTI E MENU =================
    const configTabs = [
        { btnId: "toggleMagazzinoCucinaBtn", ref: "impostazioni/magazzinoCucina", setting: "magazzinoCucina", tabSelector: "button[data-tab='ingredientiCucinaTab']" },
        { btnId: "toggleMenuCucinaBtn", ref: "impostazioni/menuCucina", setting: "menuCucina", tabSelector: "button[data-tab='menuCucinaTab']" },
        { btnId: "toggleMagazzinoBereBtn", ref: "impostazioni/magazzinoBere", setting: "magazzinoBere", tabSelector: "button[data-tab='ingredientiBereTab']" },
        { btnId: "toggleMenuBereBtn", ref: "impostazioni/menuBere", setting: "menuBere", tabSelector: "button[data-tab='menuBereTab']" },
        { btnId: "toggleMagazzinoSnackBtn", ref: "impostazioni/magazzinoSnack", setting: "magazzinoSnack", tabSelector: "button[data-tab='ingredientiSnackTab']" },
        { btnId: "toggleMenuSnackBtn", ref: "impostazioni/menuSnack", setting: "menuSnack", tabSelector: "button[data-tab='menuSnackTab']" }
    ];

    configTabs.forEach(cfg => {
        const toggleBtn = document.getElementById(cfg.btnId);
        const dbRef = db.ref(cfg.ref);
        if (toggleBtn) {
            initToggle(toggleBtn, dbRef, {on: "ON", off: "OFF"}, true, val => {
                window.settings[cfg.setting] = val;
                
                // Cerca il bottone della tab in HTML usando il data-tab (perché non hanno un ID)
                const tabBtnHtml = document.querySelector(cfg.tabSelector);
                if (tabBtnHtml) {
                    tabBtnHtml.style.display = val ? "inline-block" : "none";
                    
                    // Se stiamo spegnendo la tab e l'utente ci si trova sopra in questo momento,
                    // lo riportiamo di prepotenza alla tab "Da fare" principale
                    if (!val && tabBtnHtml.classList.contains("active")) {
                        const divPadre = tabBtnHtml.parentElement;
                        const defaultTab = divPadre.querySelector("button[data-tab^='da']");
                        if (defaultTab) defaultTab.click();
                    }
                }
            });
        }
    });
	// ================= SISTEMA EXTRA =================
	const toggleSistemaExtraBtn = document.getElementById("toggleSistemaExtraBtn");
	const sistemaExtraRef = db.ref("impostazioni/sistemaExtraAbilitato");
	if (toggleSistemaExtraBtn) {
	    initToggle(toggleSistemaExtraBtn, sistemaExtraRef, {on: "ON", off: "OFF"}, true, val => {
	        window.settings.sistemaExtraAbilitato = val;
	    });
	}
	
	// ================= SCONTRINI SEPARATI =================
	const toggleScontriniSeparatiBtn = document.getElementById("toggleScontriniSeparatiBtn");
	const scontriniSeparatiRef = db.ref("impostazioni/scontriniSeparati");
	if (toggleScontriniSeparatiBtn) {
	    initToggle(toggleScontriniSeparatiBtn, scontriniSeparatiRef, {on: "ON", off: "OFF"}, false, val => {
	        window.settings.scontriniSeparati = val;
	    });
	}
	// ================= PIATTI COMBO =================
	const toggleComboBtn = document.getElementById("toggleComboBtn");
	const comboRef = db.ref("impostazioni/piattiComboAbilitati");
	if (toggleComboBtn) {
	    initToggle(toggleComboBtn, comboRef, {on: "ON", off: "OFF"}, false, val => {
	        window.settings.piattiComboAbilitati = val;
	    });
	}
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
    
    // Aggiunge lo sfondo a box per renderlo leggibile in ogni tema
    container.className = "box-ingredienti-critici";

    // Creiamo le due colonne separate
    const colAttenzione = document.createElement("div");
    colAttenzione.className = "colonna-attenzione";
    colAttenzione.innerHTML = "<h4 class='titolo-colonna'>⚠️ In Esaurimento</h4>";

    const colEmergenza = document.createElement("div");
    colEmergenza.className = "colonna-emergenza";
    colEmergenza.innerHTML = "<h4 class='titolo-colonna'>🚨 Critici (Finiti)</h4>";

    // Cicliamo gli ingredienti e li smistiamo nelle colonne giuste
    listaCritica.forEach(i => {
        const r = document.createElement("div");
        
        if (i.critico) {
            // Se è critico va nella colonna di Destra (Emergenza)
            r.className = "badge-critico";
            r.innerHTML = `<span>${i.nome}</span> <strong>${i.rimanente} ${i.unita}</strong>`;
            colEmergenza.appendChild(r);
        } else {
            // Se è sotto soglia ma non critico va a Sinistra (Attenzione)
            r.className = "badge-sottosoglia";
            r.innerHTML = `<span>${i.nome}</span> <strong>${i.rimanente} ${i.unita}</strong>`;
            colAttenzione.appendChild(r);
        }
    });

    // Se una colonna non ha ingredienti, mostriamo un testo vuoto
    if(colAttenzione.children.length === 1) colAttenzione.innerHTML += "<p class='nessun-dato'>Nessun ingrediente</p>";
    if(colEmergenza.children.length === 1) colEmergenza.innerHTML += "<p class='nessun-dato'>Nessun ingrediente</p>";

    // Inseriamo le due colonne nel contenitore principale
    container.appendChild(colAttenzione);
    container.appendChild(colEmergenza);

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
    // Usiamo il nuovo cervello!
    getIngredientiEffettivi(p).forEach(ing => {
      if (ing.id) {
        byId[ing.id] = (parseFloat(byId[ing.id]) || 0) + (ing.qty * q);
      } else if (ing.nome) {
        const n = (ing.nome || "").trim().toLowerCase();
        byName[n] = (parseFloat(byName[n]) || 0) + (ing.qty * q);
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

        // controllo esistenza dati utente in DB
        const snap = await db.ref("utenti/" + uid).once("value");
        if (!snap.exists()) {
            notify("❌ Utente non autorizzato!", "error");
            await auth.signOut();
            return;
        }

        const userData = snap.val();

        // NUOVO CONTROLLO: Leggiamo la verifica dal nostro Database
        if (userData.email_verificata === false) {
            notify("📧 Devi prima verificare la tua email.\n👉 Clicca sul link che ti abbiamo inviato per email.", "warn");
            await auth.signOut();
            return;
        }

        // --- PULIZIA TOKEN: Se c'è ancora il token, lo cancelliamo per tenere in ordine il DB ---
        if (userData.token_verifica) {
            db.ref("utenti/" + uid).update({ token_verifica: null, token_inserito: null });
        }
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

        // NUOVO: CONTROLLO MANUTENZIONE
        const snapManutenzione = await db.ref("impostazioni/manutenzione").once("value");
        const manutenzioneAttiva = snapManutenzione.exists() && snapManutenzione.val() === true;

        if (manutenzioneAttiva && userData.ruolo !== "admin") {
            notify("🛠️ Il sistema è attualmente in MANUTENZIONE. L'accesso è consentito solo agli amministratori.", "error");
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
    document.getElementById("simulatoreRuoliDiv").style.display = "none"; 
    
    initImpostazioniToggle();

    // Mostra schermata in base al ruolo
    // Mostra schermata in base al ruolo
    if (ruolo === "cassa") { 
        if (!checkOnline(true)) return;
        window.isLoggedInCassa = true;
        window.isLoggedInAdmin = false;
        
        // 🔹 RICHIESTA FONDO CASSA (Globale per tutte le casse)
        if (typeof gestisciFondoCassa === "function") gestisciFondoCassa(false);

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
		document.getElementById("simulatoreRuoliDiv").style.display = "flex";
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
        passaBtn.style.display = "none"; // Nascosto di default, si mostra solo in simulazione

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
// ================= GESTIONE FONDO CASSA GLOBALE E ADMIN =================
function gestisciFondoCassa(forzaModifica = false) {
    db.ref("impostazioni/fondoCassa").once("value").then(snap => {
        const fondoAttuale = snap.exists() ? snap.val() : "";
        
        // Se il fondo c'è già nel database e NON stiamo cliccando da Admin, esci e lascia lavorare la Cassa
        if (!forzaModifica && snap.exists() && fondoAttuale !== "") return;

        // Sicurezza: Evita di aprire modali doppi
        if (document.getElementById("modaleFondoCassa")) return;

        const overlay = document.createElement("div");
        overlay.className = "modal-overlay";
        overlay.id = "modaleFondoCassa";
        overlay.style.zIndex = "10005";

        const modal = document.createElement("div");
        modal.className = "modal-varianti";
        modal.style.textAlign = "center";

        modal.innerHTML = `
            <h3 style="margin-bottom: 15px; color: #333;">Fondo Cassa Iniziale</h3>
            <p style="font-size: 0.9em; color: #555; margin-bottom: 15px;">
                ${forzaModifica ? "Modifica l'importo attuale o azzera il fondo." : "Inserisci l'importo di partenza presente in cassa per la giornata."}
            </p>
            <input type="number" step="0.01" id="inputFondoCassa" value="${fondoAttuale !== "" ? fondoAttuale : "50.00"}" 
                   style="width: 100%; box-sizing: border-box; padding: 10px; margin-bottom: 20px; border: 1px solid #ccc; border-radius: 6px; font-size: 1.1rem; text-align: center;">
            <div class="modal-actions">
                ${forzaModifica ? `<button class="btn-chiudi" id="btnChiudiFondo">Annulla</button>` : ""}
                <button class="btn-salva" id="btnSalvaFondo" style="${forzaModifica ? '' : 'width: 100%;'}">Conferma Fondo</button>
            </div>
            ${forzaModifica ? `<button id="btnAzzeraFondo" style="width: 100%; margin-top: 15px; padding: 10px; background: #f44336; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold;">Resetta (Verrà chiesto in Cassa)</button>` : ""}
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Se siamo in Admin, abilitiamo il tasto di chiusura e di reset
        if (forzaModifica) {
            document.getElementById("btnChiudiFondo").onclick = () => overlay.remove();
            document.getElementById("btnAzzeraFondo").onclick = () => {
                db.ref("impostazioni/fondoCassa").remove();
                overlay.remove();
                notify("Fondo azzerato. Verrà richiesto al prossimo accesso in Cassa.", "info");
            };
        }

        // Tasto di salvataggio (usato sia dalla Cassa che dall'Admin)
        document.getElementById("btnSalvaFondo").onclick = () => {
            let valStr = document.getElementById("inputFondoCassa").value.replace(",", ".");
            const fondo = parseFloat(valStr);
            if (!isNaN(fondo) && fondo >= 0) {
                db.ref("impostazioni/fondoCassa").set(fondo);
                overlay.remove();
                notify("Fondo cassa salvato: €" + fondo.toFixed(2), "success");
            } else {
                notify("Inserisci un importo numerico valido", "error");
            }
        };
    });
}

// Ascoltatore per il bottone nelle Impostazioni dell'Admin
document.addEventListener("DOMContentLoaded", () => {
    const btnAdminFondo = document.getElementById("impostaFondoCassaBtn");
    if (btnAdminFondo) {
        btnAdminFondo.onclick = () => gestisciFondoCassa(true);
    }
});
// ================== CHAT INTERNA GLOBALE ==================
function ruoloCapitalizzato() {
  if (!ruolo) return "";
  return ruolo.charAt(0).toUpperCase() + ruolo.slice(1);
}

function initChat() {
  // 1. SPEGNE LA CHAT VECCHIA -> Evita che il sistema "si inchiodi"
  db.ref("chat/messaggi").off("value");

  // 2. TROVA I DIV IN MODO DINAMICO -> Funziona in Cucina, Bere, Snack, ecc. (Senza usare adminInCassa!)
  const ruoloCap = ruoloCapitalizzato();
  const chatContainer = document.getElementById(`chatContainer${ruoloCap}`);
  const chatInput = document.getElementById(`chatInput${ruoloCap}`);
  const chatSendBtn = document.getElementById(`chatSend${ruoloCap}Btn`);

  // Se i div non esistono a schermo, fermati senza dare errori
  if (!chatContainer || !chatInput || !chatSendBtn) return;

  const chatRef = db.ref("chat/messaggi");
  const notificati = new Set(JSON.parse(localStorage.getItem("chatNotificati_" + uid) || "[]"));

  // 3. CARICA MESSAGGI
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

    // 4. NOTIFICHE
    Object.values(data).forEach(msg => {
        const msgKey = `${msg.uid}_${msg.timestamp}`;
        if (msg.uid !== uid && !notificati.has(msgKey)) {
            if (!window.settings.chatAbilitata) return;

            if (window.settings.suonoChat) riproduciSuonoNotifica();
            notify(`💬 Nuovo messaggio da: ${msg.email} (${msg.ruolo})`, "info");

            notificati.add(msgKey); 
            localStorage.setItem("chatNotificati_" + uid, JSON.stringify([...notificati])); 
        }
    });
    chatContainer.scrollTop = chatContainer.scrollHeight;
  });

  // 5. INVIO MESSAGGIO CON RUOLO REALE
  chatSendBtn.onclick = null; // Pulisce click precedenti
  chatSendBtn.onclick = async () => {
    if (!window.settings.chatAbilitata) {
        notify("💬 La chat è disabilitata dall'amministratore.", "warn");
        return;
    }
    const testo = chatInput.value.trim();
    if (!testo) return;

    // Questa chiamata assicura che tu sia sempre "admin" se il tuo account è admin
    const userSnap = await db.ref("utenti/" + uid).once("value");
    const user = userSnap.val() || {};

    const newMsg = {
      testo,
      ruolo: user.ruolo || ruolo || "sconosciuto", 
      email: user.username || "anonimo",
      uid: uid,
      timestamp: Date.now()
    };

    await chatRef.push(newMsg);
    chatInput.value = "";

    // PULIZIA VECCHI MESSAGGI DAL DATABASE
    const snap = await chatRef.once("value");
    const data = snap.val() || {};
    const keys = Object.keys(data);
    if (keys.length > 10) {
      const toDelete = keys
          .sort((a, b) => data[a].timestamp - data[b].timestamp)
          .slice(0, keys.length - 10);

      toDelete.forEach(k => {
          chatRef.child(k).remove();
          const msg = data[k];
          if (msg) notificati.delete(`${msg.uid}_${msg.timestamp}`);
      });
      localStorage.setItem("chatNotificati_" + uid, JSON.stringify([...notificati]));
    }
  };
}
// --- SIMULAZIONE RUOLI DA ADMIN ---
const passaBtn = document.getElementById("passaACassaBtn");

window.simulaRuolo = function(ruoloScelto) {
    if (!checkOnline(true)) return;

    // Nascondi tutto
    document.getElementById("adminDiv").classList.add("hidden");
    document.getElementById("cassaDiv").classList.add("hidden");
    document.getElementById("cucinaDiv").classList.add("hidden");
    document.getElementById("bereDiv").classList.add("hidden");
    document.getElementById("snackDiv").classList.add("hidden");
	document.getElementById("simulatoreRuoliDiv").style.display = "none";
    
    // Imposta il bottone di ritorno
    passaBtn.style.display = "inline-block";
    passaBtn.style.background = "#d32f2f"; 
    passaBtn.style.color = "white";
    passaBtn.innerText = "🔙 Torna ad Admin";
    passaBtn.onclick = mostraAdminDaSimulazione;

    // Spegni i listener di Admin inclusa la chat precedente
    db.ref("ingredienti").off();
    db.ref("comande").off();
    db.ref("menu").off();
    db.ref("utenti").off();
    db.ref("chat/messaggi").off("value");

    // Override temporaneo delle variabili globali
    ruolo = ruoloScelto; 
    window.isLoggedInAdmin = false; 

    if (ruoloScelto === "cassa") {
        window.isLoggedInCassa = true;
        document.getElementById("cassaDiv").classList.remove("hidden");
        caricaMenuCassa();
        caricaComandeCassa();
        initIngredientiCriticiListeners(true);
        initTickNoteDestinazioni();
		if (typeof gestisciFondoCassa === "function") gestisciFondoCassa(false);
		if (typeof renderPreordiniCassa === "function") {
            db.ref("preordini").once("value").then(snap => renderPreordiniCassa(snap.val() || {}));
        }
        document.querySelector("#cassaDiv .tabBtn:first-child").click();
    } else {
        window.isLoggedInCassa = false;
        // Se snack è disattivato globalmente, blocca la simulazione
        if (ruoloScelto === "snack" && !window.settings.snackAbilitato) {
            notify("⚠️ Il profilo Snack è disattivato nelle impostazioni globali.", "warn");
            mostraAdminDaSimulazione();
            return;
        }
        initRuoloTab(ruoloScelto);
    }

    // INIZIALIZZA LA CHAT NELLA SCHERMATA SIMULATA
    initChat();
};

function mostraAdminDaSimulazione() {
    if (!checkOnline(true)) return;
    
    // Ripristina variabili globali
    ruolo = "admin";
    window.isLoggedInAdmin = true;
    window.isLoggedInCassa = false;
	document.getElementById("simulatoreRuoliDiv").style.display = "flex";
    
    // Nascondi tutte le aree
    document.getElementById("cassaDiv").classList.add("hidden");
    document.getElementById("cucinaDiv").classList.add("hidden");
    document.getElementById("bereDiv").classList.add("hidden");
    document.getElementById("snackDiv").classList.add("hidden");

    // Mostra Admin e nascondi il bottone di ritorno
    document.getElementById("adminDiv").classList.remove("hidden");
    passaBtn.style.display = "none";
    passaBtn.style.background = ""; // reset
    passaBtn.style.color = ""; // reset

    // Pulisci tutti i listener delle simulazioni
    db.ref("comande").off();
    db.ref("ingredienti").off();
    db.ref("menu").off();
    db.ref("chat/messaggi").off("value"); // Chiudi la chat della simulazione

    // Ricarica dati Admin
    caricaIngredienti();
    caricaGestioneComandeAdmin();
    caricaStatistiche();
    caricaMenuAdmin();
    caricaUtenti();
	if (typeof renderPreordiniAdmin === "function") {
        db.ref("preordini").once("value").then(snap => renderPreordiniAdmin(snap.val() || {}));
    }

    // RIATTIVA LA CHAT ADMIN
    initChat();
    
    document.querySelector("#adminDiv .tabBtn:first-child").click();
}
// REGISTRAZIONE utenti da admin
document.getElementById("registraBtn").onclick = async () => {
    const email = document.getElementById("newUsername").value.trim();
    const password = document.getElementById("newPass").value;
    const ruoloNuovo = document.getElementById("newRole").value;

    if(!email || !password){ notify("Compila tutti i campi", "warn"); return; }

    try{
        // 1. Creiamo un'app Firebase secondaria al volo per non perdere la sessione Admin
        const secondaryApp = firebase.initializeApp(firebaseConfig, "Secondary");
        
        // 2. Creiamo l'utente sull'app secondaria
        const res = await secondaryApp.auth().createUserWithEmailAndPassword(email, password);
        // NIENTE INVIO EMAIL
        
        // 3. Salviamo i dati sul Database 
        await db.ref("utenti/"+res.user.uid).set({
            username: email,
            ruolo: ruoloNuovo,
            approvato: true,
            attivo: true,
            email_verificata: true // <--- Essendo creato dall'admin, è già verificato!
        });
        
        // 4. Facciamo il logout dall'app secondaria e la distruggiamo per fare pulizia
        await secondaryApp.auth().signOut();
        await secondaryApp.delete();

        notify("Utente creato con successo e approvato automaticamente!", "info");
        document.getElementById("newUsername").value = "";
        document.getElementById("newPass").value = "";
        document.getElementById("newRole").value = "";
    } catch(err){
        notify("Errore: " + err.message, "warn");
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
function separaComanda(items) {
    if (!Array.isArray(items)) return { cibo: [], bere: [], snack: [] };

    let cibo = [];
    let bere = [];
    let snack = [];

    const snackAbilitato = window.settings?.snackAbilitato === true;

    function getDest(categoria, tipo, nome) {
        const cat = (categoria || "").toLowerCase();
        const tip = (tipo || "").toLowerCase();
        const nom = (nome || "").toLowerCase();

        if (cat === "bevande" || tip === "bere") return "bere";
        if (cat === "snack" || cat.includes("fritti") || tip === "snack" || nom.includes("patatine") || nom.includes("fritto")) {
            return snackAbilitato ? "snack" : "cibo";
        }
        return "cibo";
    }

    items.forEach(i => {
        const destMain = getDest(i.categoria, i.tipo, i.nome);

        let cloneCibo = null;
        let cloneBere = null;
        let cloneSnack = null;

        const getClone = (dest) => {
            if (dest === "cibo") {
                if (!cloneCibo) cloneCibo = JSON.parse(JSON.stringify({ ...i, isMainHere: false, contorniScelti: [] }));
                return cloneCibo;
            }
            if (dest === "bere") {
                if (!cloneBere) cloneBere = JSON.parse(JSON.stringify({ ...i, isMainHere: false, contorniScelti: [] }));
                return cloneBere;
            }
            if (dest === "snack") {
                if (!cloneSnack) cloneSnack = JSON.parse(JSON.stringify({ ...i, isMainHere: false, contorniScelti: [] }));
                return cloneSnack;
            }
        };

        // 1. Assegna il Piatto Principale
        getClone(destMain).isMainHere = true;

        // 2. Smista i Contorni nelle rispettive stazioni
        if (i.contorniScelti && i.contorniScelti.length > 0) {
            i.contorniScelti.forEach(c => {
                const destC = getDest(c.categoria, "", c.nome);
                
                // SE il contorno va in una stazione DIVERSA da quella del genitore...
                if (destC !== destMain) {
                    
                    // 🔥 NESSUN varTxt QUI! Lasciamo l'array varianti intatto per i colori e usiamo JSON per clonarlo
                    const splitItem = {
                        id: (i.id || "contorno") + "_split_" + Math.floor(Math.random() * 10000),
                        id_univoco: "split_" + Math.random().toString(36).substr(2, 9),
                        nome: `${c.nome} [di ${i.nome}]`, 
                        prezzo: 0,
                        quantita: i.quantita || 1,
                        categoria: c.categoria || "Snack",
                        tipo: destC,
                        isCombo: false,      
                        isMainHere: true,    
                        varianti: c.varianti ? JSON.parse(JSON.stringify(c.varianti)) : [], // Salva l'array puro!
                        contorniScelti: [],
                        ingredienti: [],
                        note: i.note || ""
                    };

                    if (destC === "snack") snack.push(splitItem);
                    if (destC === "cibo") cibo.push(splitItem);
                    if (destC === "bere") bere.push(splitItem);

                } else {
                    getClone(destC).contorniScelti.push(c);
                }
            });
        }

        // 3. Inserisci i cloni finali del genitore
        if (cloneCibo && cloneCibo.isMainHere) cibo.push(cloneCibo);
        if (cloneBere && cloneBere.isMainHere) bere.push(cloneBere);
        if (cloneSnack && cloneSnack.isMainHere) snack.push(cloneSnack);
    });

    return { cibo, bere, snack };
}
async function caricaMenuCassa() {
    if (!checkOnline(true)) return;
    showLoader();

    // Applica subito il layout se l'opzione è attiva
    const cassaContainer = document.getElementById("aggiungiComandaTab");
    if (cassaContainer) {
        if (window.settings.cassaOttimizzata) cassaContainer.classList.add("cassa-ottimizzata");
        else cassaContainer.classList.remove("cassa-ottimizzata");
    }

    const menuCibiDiv = document.getElementById("menuCibi");
    const menuBevandeDiv = document.getElementById("menuBevande");
    const menuSnackDiv = document.getElementById("menuSnack");
    const menuRef = db.ref("menu");
    const ingredientiRef = db.ref("ingredienti");

    function renderMenuCassa() {
        if (!window.menuData || !window.ingredientData) return;

        // Disegna le griglie
        menuCibiDiv.innerHTML = "<h3 style='margin: 0 0 10px 0; text-align:center;'>Cibi</h3><div class='menu-grid' id='grid-cibi'></div>";
        menuBevandeDiv.innerHTML = "<h3 style='margin: 15px 0 10px 0; text-align:center;'>Bevande</h3><div class='menu-grid' id='grid-bevande'></div>";
        menuSnackDiv.innerHTML = "<h3 style='margin: 15px 0 10px 0; text-align:center;'>Snack</h3><div class='menu-grid' id='grid-snack'></div>";

        Object.entries(window.menuData || {}).forEach(([id, item]) => {
            // Creo il bottone sempre nuovo (evita il bug della sparizione!)
            let btn = document.createElement("button");
            btn.className = "piatto-btn";
            btn.dataset.menuId = id;

            btn.onclick = () => {
                // SE E' UNA COMBO, ignoriamo la quantità multipla e apriamo il modale speciale!
                if (window.settings.piattiComboAbilitati && item.isCombo) {
                    if (typeof apriPopupCombo === "function") apriPopupCombo(id, "cassa");
                    return;
                }

                let quant = 1; 
                if (window.settings.selettoreQuantitaCassa) {
                    const quantVal = document.getElementById("quantita").value;
                    quant = parseInt(quantVal);
                    if (!quant || quant <= 0) { notify("Seleziona prima la quantità!", "warn"); return; }
                }
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
                        sconto: item.sconto || null, 
                        maxVariantiGratis: item.maxVariantiGratis || 0  // 🔹 Qui aggiungiamo "|| 0" per evitare il crash!
                    });
                }
                aggiornaComandaCorrente();
            };

            const wrapper = document.createElement("div");
            wrapper.style.width = "100%";
            
            const nomeDiv = document.createElement("div");
            nomeDiv.className = "piatto-nome";
            nomeDiv.textContent = item.nome;
            wrapper.appendChild(nomeDiv);

            const prezzoDiv = document.createElement("div");
            prezzoDiv.className = "piatto-prezzo";
            prezzoDiv.innerText = item.sconto ? `€${calcolaPrezzoConSconto(item).toFixed(2)}` : `€${item.prezzo.toFixed(2)}`;
            wrapper.appendChild(prezzoDiv);

            if (item.ingredienti && item.ingredienti.length) {
                const ingDiv = document.createElement("div");
                ingDiv.className = "piatto-ing";
                ingDiv.textContent = "Ing: " + item.ingredienti.map(ing => ing.nome || ing.id).join(", ");
                wrapper.appendChild(ingDiv);
            }

            btn.appendChild(wrapper);

            const categoria = (item.categoria || "").toLowerCase();
            if (categoria === "cibi") document.getElementById("grid-cibi").appendChild(btn);
            else if (categoria === "bevande") document.getElementById("grid-bevande").appendChild(btn);
            else if (categoria === "snack") document.getElementById("grid-snack").appendChild(btn);
        });

        hideLoader();
    }

    Promise.all([ingredientiRef.once("value"), menuRef.once("value")]).then(([snapIng, snapMenu]) => {
        window.ingredientData = snapIng.val() || {};
        window.menuData = snapMenu.val() || {};
        renderMenuCassa();
        aggiornaBottoniBloccati();

        // Elimina vecchi listener per evitare bug di caricamento doppio
        ingredientiRef.off("value");
        menuRef.off("value");

        ingredientiRef.on("value", snap => { window.ingredientData = snap.val() || {}; aggiornaBottoniBloccati(); });
        menuRef.on("value", snap => { window.menuData = snap.val() || {}; aggiornaBottoniBloccati(); });
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

        const span = document.createElement("span");
        span.style.cursor = "pointer"; 
        span.style.flex = "1";
        
        let testoVarianti = "";
        let variantiArray = i.varianti ? (Array.isArray(i.varianti) ? i.varianti : Object.values(i.varianti)) : [];
        
        if (variantiArray.length > 0) {
            let conteggio = {};
            variantiArray.forEach(v => {
                let key = v.tipo + "_" + v.nome;
                if (!conteggio[key]) conteggio[key] = { tipo: v.tipo, nome: v.nome, count: 0 };
                conteggio[key].count++;
            });
            
            const mapVarianti = Object.values(conteggio).map(v => {
                let qTxt = v.count > 1 ? `${v.count}x ` : "";
                if (v.tipo === "aggiunta") return `<span style="color:green">+ ${qTxt}${v.nome}</span>`;
                else return `<span style="color:red">- Senza ${v.nome}</span>`;
            }).join("<br>");

            testoVarianti = `<br><small style="font-weight:bold;">${mapVarianti}</small>`;
        }
        
        // --- NUOVO BLOCCO CONTORNI COMBO ---
        if (i.contorniScelti && i.contorniScelti.length > 0) {
            const cTxt = i.contorniScelti.map((c, cIndex) => {
                let varsTxt = c.varianti && c.varianti.length > 0 ? " <small style='color:#777;'>(" + c.varianti.map(v => v.tipo==='aggiunta'?`+${v.nome}`:`-${v.nome}`).join(", ") + ")</small>" : "";
                return c.isGratis 
                    ? `<span style="color:#2e7d32; cursor:pointer; text-decoration:underline;" onclick="event.stopPropagation(); apriPopupVariantiContorno(${idx}, ${cIndex})">+ ${c.nome} (Incluso)${varsTxt}</span>` 
                    : `<span style="color:#555; cursor:pointer; text-decoration:underline;" onclick="event.stopPropagation(); apriPopupVariantiContorno(${idx}, ${cIndex})">+ ${c.nome} (+€${c.prezzoPagato.toFixed(2)})${varsTxt}</span>`;
            }).join("<br>");
            testoVarianti += `<br><small style="font-weight:bold;">${cTxt}</small>`;
        }
        
        const prezzoPiattoAttuale = (i.prezzo + (i.extraPrezzo || 0));

        const costoRigaScontato = calcolaPrezzoConSconto(i, comandaCorrente);
        
        if(i.sconto){
            if(i.sconto.tipo === "percentuale"){
                span.innerHTML = `<b style="color:#0056b3;">${i.quantita}x ${i.nome}</b> 
                    <span style="text-decoration: line-through; color:red;">€${(prezzoPiattoAttuale * i.quantita).toFixed(2)}</span> 
                    <span style="color:red;">€${costoRigaScontato.toFixed(2)}</span>` + testoVarianti;
            } else {
                // Per le promo X paghi Y mostriamo il totale già scontato bello pulito (Es: 5x Frittelle €4.00)
                span.innerHTML = `<b style="color:#0056b3;">${i.quantita}x ${i.nome}</b> (€${costoRigaScontato.toFixed(2)})` + testoVarianti;
            }
        } else {
            span.innerHTML = `<b style="color:#0056b3;">${i.quantita}x ${i.nome}</b> (€${(prezzoPiattoAttuale * i.quantita).toFixed(2)})` + testoVarianti;
        }

        // Il piatto è SEMPRE cliccabile, anche se gli extra a pagamento sono off, così si possono rimuovere gli ingredienti
        span.onclick = () => apriPopupVarianti(idx);
        span.title = "Clicca per modificare ingredienti";
        

        if (window.settings.sistemaExtraAbilitato) {
		    span.onclick = () => apriPopupVarianti(idx);
		    span.title = "Clicca per personalizzare le varianti";
		} else {
		    span.onclick = null;
		    span.style.cursor = "default";
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
		btnDelete.innerText = "X";
		btnDelete.style.marginLeft = "6px";
		btnDelete.style.color = "#000000"; // Nero
		btnDelete.style.fontWeight = "900"; // Grassetto marcato
		btnDelete.style.backgroundColor = "#ffcccc"; // Sfondo rosso chiaro per contrasto
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
	sincronizzaDisplayLive();
}
// ================= CALCOLO INGREDIENTI EFFETTIVI (CON VARIANTI) =================
function getIngredientiEffettivi(p) {
    let mappa = {}; 
    // Aggiungiamo base
    (p.ingredienti || []).forEach(i => {
        mappa[i.id] = { id: i.id, nome: i.nome, qty: parseFloat(i.qtyPerUnit || 1) };
    });
    // Applichiamo le varianti (+ o -)
    (p.varianti || []).forEach(v => {
        if (v.tipo === "aggiunta") {
            if (mappa[v.id]) mappa[v.id].qty += parseFloat(v.qty || 1);
            else mappa[v.id] = { id: v.id, nome: v.nome, qty: parseFloat(v.qty || 1) };
        } else if (v.tipo === "rimozione") {
            if (mappa[v.id]) {
                const baseQty = p.ingredienti.find(i => i.id === v.id)?.qtyPerUnit || 1;
                mappa[v.id].qty = Math.max(0, mappa[v.id].qty - baseQty);
                if (mappa[v.id].qty === 0) delete mappa[v.id];
            }
        }
    });
    return Object.values(mappa);
}

// ================= POPUP VARIANTI =================
// ================= POPUP VARIANTI CASSA (UNIFICATO E OTTIMIZZATO) =================
function apriPopupVarianti(idx) {
    const piatto = comandaCorrente[idx];
    
    // DIVISIONE AUTOMATICA: Se la quantità > 1, stacchiamo un singolo piatto e apriamo il popup su di lui
    if (piatto.quantita > 1) {
        piatto.quantita -= 1;
        const piattoSingolo = JSON.parse(JSON.stringify(piatto));
        piattoSingolo.quantita = 1;
        piattoSingolo.varianti = [];
        piattoSingolo.extraPrezzo = 0;
        
        comandaCorrente.splice(idx + 1, 0, piattoSingolo);
        aggiornaComandaCorrente();
        apriPopupVarianti(idx + 1); 
        return;
    }

    if (!piatto.varianti) piatto.varianti = [];
    if (!piatto.extraPrezzo) piatto.extraPrezzo = 0;

    let tempVarianti = JSON.parse(JSON.stringify(piatto.varianti));
    let tempExtraPrezzo = piatto.extraPrezzo;

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";

    const modal = document.createElement("div");
    modal.className = "modal-varianti";
    
    let maxGratis = piatto.maxVariantiGratis || 0;
	// Sistema anti-errore: se il dato manca, lo peschiamo dal menu originale
	if (!maxGratis && window.menuData) {
		const piattoOriginale = Object.values(window.menuData).find(m => m.nome === piatto.nome);
		if (piattoOriginale && piattoOriginale.maxVariantiGratis) {
			maxGratis = parseInt(piattoOriginale.maxVariantiGratis);
		}
	}
    
    // 🔹 PREVIENE IL CRASH: Assicuriamoci che il piatto non porti con sé un valore "undefined"
    piatto.maxVariantiGratis = maxGratis;
    const testoGratis = maxGratis > 0 ? `<br><small style="color:green; font-size:0.75em;">(Promozione: Hai ${maxGratis} aggiunte GRATIS!)</small>` : "";
    
    const titolo = document.createElement("h3");
    titolo.innerHTML = `Modifica: ${piatto.nome} ${testoGratis}`;
    modal.appendChild(titolo);

    const listaDiv = document.createElement("div");

    // IL CERVELLO DEL PREZZO: Calcola da zero basandosi sulle varianti nell'array
    function ricalcolaExtraPrezzo() {
        let totaleExtra = 0;
        const aggiunte = tempVarianti.filter(v => v.tipo === "aggiunta");

        aggiunte.forEach((v, index) => {
            if (index >= maxGratis) {
                totaleExtra += Number(v.prezzo || 0);
            }
        });
        tempExtraPrezzo = totaleExtra;
    }

    function renderListaIngredienti() {
        ricalcolaExtraPrezzo(); // Ricalcola ad ogni click
        
        const aggiunteFatte = tempVarianti.filter(v => v.tipo === "aggiunta").length;
        const isProssimaGratis = aggiunteFatte < maxGratis;

        listaDiv.innerHTML = "";
        // FIX: Recuperiamo sia gli ID che i nomi esatti per compatibilità con i piatti vecchi
        const baseIds = (piatto.ingredienti || []).map(i => i.id).filter(id => id);
        const baseNomi = (piatto.ingredienti || []).map(i => (i.nome || "").trim().toLowerCase());

        Object.entries(window.ingredientData || {}).forEach(([id, ing]) => {
            const catsApp = ing.categorieApplicabili || [ing.categoria || "cibi"];
            
            // FIX: Se un piatto vecchio ha la vecchia categoria "cucina", la convertiamo in "cibi"
            let catPiatto = (piatto.categoria || "cibi").toLowerCase();
            if (catPiatto === "cucina") catPiatto = "cibi"; 

            // Riconosce l'ingrediente base sia dall'ID che dal nome
            const isBase = baseIds.includes(id) || baseNomi.includes((ing.nome || "").trim().toLowerCase());
            const isExtraFlag = (ing.usabileComeExtra === true) && catsApp.includes(catPiatto);

            let allowRemove = false;
            let allowAdd = false;

            if (window.settings.sistemaExtraAbilitato) {
                if (isBase) allowRemove = true;
                if (isExtraFlag) allowAdd = true;
            } else {
                if (isBase && isExtraFlag) allowRemove = true;
            }

            if (!allowRemove && !allowAdd) return; 

            const row = document.createElement("div");
            row.className = "variante-row";
            const nomeSpan = document.createElement("span");
            nomeSpan.innerText = ing.nome;
            const btnContainer = document.createElement("div");

            if (allowRemove) {
                const btnRemove = document.createElement("button");
                const isRimosso = tempVarianti.some(v => v.tipo === "rimozione" && v.id === id);
                if (isRimosso) {
                    btnRemove.className = "variante-btn disabled";
                    btnRemove.innerText = "Annulla Rimozione";
                    btnRemove.onclick = () => {
                        tempVarianti = tempVarianti.filter(v => !(v.tipo === "rimozione" && v.id === id));
                        renderListaIngredienti();
                    };
                } else {
                    btnRemove.className = "variante-btn remove";
                    btnRemove.innerText = "- Rimuovi";
                    btnRemove.onclick = () => {
                        tempVarianti.push({ tipo: "rimozione", id: id, nome: ing.nome });
                        renderListaIngredienti();
                    };
                }
                btnContainer.appendChild(btnRemove);
            }

            if (allowAdd) {
                const costoExtra = ing.prezzoExtra !== undefined ? Number(ing.prezzoExtra) : 0.50; 
                const qtyExtra = ing.qtyExtra !== undefined ? Number(ing.qtyExtra) : 1;
                const occorrenze = tempVarianti.filter(v => v.tipo === "aggiunta" && v.id === id).length;

                const wrapperAdd = document.createElement("div");
                wrapperAdd.style.display = "inline-flex"; wrapperAdd.style.alignItems = "center"; wrapperAdd.style.marginLeft = "5px";

                if (occorrenze > 0) {
                    const btnMinus = document.createElement("button"); btnMinus.className = "variante-btn remove"; btnMinus.innerText = "-"; btnMinus.style.padding = "4px 10px";
                    btnMinus.onclick = () => {
                        const reversedIndex = [...tempVarianti].reverse().findIndex(v => v.tipo === "aggiunta" && v.id === id);
                        if (reversedIndex !== -1) tempVarianti.splice(tempVarianti.length - 1 - reversedIndex, 1);
                        renderListaIngredienti();
                    };
                    const spanCount = document.createElement("span"); spanCount.innerText = occorrenze; spanCount.style.margin = "0 8px"; spanCount.style.fontWeight = "bold";
                    const btnPlus = document.createElement("button"); btnPlus.className = "variante-btn add"; btnPlus.innerText = "+"; btnPlus.style.padding = "4px 10px";
                    btnPlus.onclick = () => { tempVarianti.push({ tipo: "aggiunta", id: id, nome: ing.nome, qty: qtyExtra, prezzo: costoExtra }); renderListaIngredienti(); };

                    wrapperAdd.appendChild(btnMinus); wrapperAdd.appendChild(spanCount); wrapperAdd.appendChild(btnPlus);
                } else {
                    const btnAdd = document.createElement("button"); btnAdd.className = "variante-btn add";
                    btnAdd.innerText = isProssimaGratis ? `+ Aggiungi (GRATIS)` : `+ Aggiungi (€${costoExtra.toFixed(2)})`;
                    btnAdd.onclick = () => { tempVarianti.push({ tipo: "aggiunta", id: id, nome: ing.nome, qty: qtyExtra, prezzo: costoExtra }); renderListaIngredienti(); };
                    wrapperAdd.appendChild(btnAdd);
                }
                btnContainer.appendChild(wrapperAdd);
            }
            row.appendChild(nomeSpan); row.appendChild(btnContainer); listaDiv.appendChild(row);
        });
    }

    renderListaIngredienti();
    modal.appendChild(listaDiv);

    const actionDiv = document.createElement("div");
    actionDiv.className = "modal-actions";

    const btnAnnulla = document.createElement("button");
    btnAnnulla.className = "btn-chiudi";
    btnAnnulla.innerText = "Annulla";
    btnAnnulla.onclick = () => overlay.remove();

    const btnSalva = document.createElement("button");
    btnSalva.className = "btn-salva";
    btnSalva.innerText = "Salva";
    btnSalva.onclick = () => {
        piatto.varianti = tempVarianti;
        piatto.extraPrezzo = tempExtraPrezzo;
        aggiornaComandaCorrente();
        overlay.remove();
    };

    actionDiv.appendChild(btnAnnulla);
    actionDiv.appendChild(btnSalva);
    modal.appendChild(actionDiv);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
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

    // Se il sistema progressivo è attivo, non serve controllare che 'num' sia compilato
    const numOk = window.settings.comandeProgressive ? true : !!num;

    // Se la lettera è disabilitata nelle impostazioni, saltiamo il controllo
    const letteraOk = window.settings.letteraComandaAbilitata ? (lettera && /^[A-Z]$/.test(lettera)) : true;

    // disabilita se manca numero, lettera (se abilitata) o piatti
    inviaBtn.disabled = !(numOk && letteraOk && hasPiattiValidi);

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
// --- FUNZIONE CALCOLO SCONTO (AGGIORNATA PER VARIANTI) ---
function calcolaPrezzoConSconto(piatto, comandaIntera = null){
    if (!checkOnline(true)) return;
    const q = piatto.quantita || 1;
    const prezzoBaseEExtra = piatto.prezzo + (piatto.extraPrezzo || 0);

    if(!piatto.sconto) return prezzoBaseEExtra * q;

    if(piatto.sconto.tipo === "percentuale"){
        return prezzoBaseEExtra * q * (1 - (Number(piatto.sconto.valore)||0)/100);
    } 

    if(piatto.sconto.tipo === "x_paga_y" || piatto.sconto.tipo === "x_paga_y_fisso"){
        let qTotale = q;
        if (comandaIntera && Array.isArray(comandaIntera)) {
            // Conta TUTTI i piatti uguali nel carrello per far scattare lo sconto globale
            qTotale = comandaIntera.filter(p => p.nome === piatto.nome).reduce((sum, p) => sum + (p.quantita || 1), 0);
        }
        
        const x = parseInt(piatto.sconto.valore.x);
        if (qTotale < x) return prezzoBaseEExtra * q;

        const numGruppi = Math.floor(qTotale / x);
        const resto = qTotale % x;
        
        let costoScontatoIntero = 0;
        if (piatto.sconto.tipo === "x_paga_y") {
            const y = parseInt(piatto.sconto.valore.y);
            costoScontatoIntero = (numGruppi * y * piatto.prezzo) + (resto * piatto.prezzo);
        } else { // x_paga_y_fisso
            const y = parseFloat(piatto.sconto.valore.y);
            costoScontatoIntero = (numGruppi * y) + (resto * piatto.prezzo); // Es: 1 gruppo * 20€
        }

        const costoTotaleBase = qTotale * piatto.prezzo; 
        const scontoTotale = costoTotaleBase - costoScontatoIntero;

        // Distribuisci lo sconto in modo proporzionale su questa riga
        const quotaSconto = (q / qTotale) * scontoTotale;
        return (prezzoBaseEExtra * q) - quotaSconto;
    }

    return prezzoBaseEExtra * q;
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
		sincronizzaDisplayLive();
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
	sincronizzaDisplayLive();
};
// ================= GESTIONE PIATTI COMBO =================
let statoComboCorrente = { piattoId: null, contorniSelezionati: [], contesto: "cassa" };

window.chiudiPopupCombo = function() {
    const p = document.getElementById("popupCombo");
    if(p) p.style.display = "none";
};

window.apriPopupCombo = function(id, contesto = "cassa") {
    const piatto = window.menuData ? window.menuData[id] : null;
    if (!piatto) return;

    statoComboCorrente = { piattoId: id, contorniSelezionati: [], contesto: contesto };
    const titoloEl = document.getElementById("titoloCombo");
    if(titoloEl) titoloEl.innerText = `Scegli i contorni per: ${piatto.nome}`;
    
    const popupEl = document.getElementById("popupCombo");
    if(popupEl) popupEl.style.display = "flex";

    renderListaPiattiCombo(piatto);
};

function renderListaPiattiCombo(piattoCombo) {
    const listaDiv = document.getElementById("listaPiattiCombo");
    if (!listaDiv) return;
    listaDiv.innerHTML = "";
    
    const maxGratis = piattoCombo.maxContorniGratis || 0;
    const arrayIDValidi = piattoCombo.piattiComboAmmessi || []; 

    const infoGratisEl = document.getElementById("infoComboGratis");
    if(infoGratisEl) {
        infoGratisEl.innerText = maxGratis > 0 
            ? `Hai diritto a ${maxGratis} contorn${maxGratis > 1 ? 'i' : 'o'} GRATIS!` 
            : `Nessun contorno gratis incluso, verranno calcolati a prezzo di listino.`;
    }

    let piattiAmmessi = [];
    Object.entries(window.menuData || {}).forEach(([pId, p]) => {
        if (arrayIDValidi.includes(pId) && !p.bloccato) {
            piattiAmmessi.push({ id: pId, ...p });
        }
    });

    if (piattiAmmessi.length === 0) {
        listaDiv.innerHTML = "<p>Nessun contorno disponibile al momento.</p>";
    }

   // --- CALCOLO INTELLIGENTE SCONTI PER I CONTORNI ---
    let contorniPagamento = statoComboCorrente.contorniSelezionati.slice(maxGratis);
    let gruppiPagamento = {};
    contorniPagamento.forEach(c => {
        const key = c.id || c.nome;
        if (!gruppiPagamento[key]) gruppiPagamento[key] = { ...c, count: 0 };
        gruppiPagamento[key].count++;
    });

    let totaleExtra = 0;
    Object.values(gruppiPagamento).forEach(g => {
        const pOriginale = (window.menuData && g.id) ? window.menuData[g.id] : {};
        let costoGruppo = g.prezzoBase * g.count; 

        if (pOriginale.sconto) {
            const sc = pOriginale.sconto;
            if (sc.tipo === "percentuale") {
                costoGruppo -= (costoGruppo * (sc.valore / 100));
            } else if (sc.tipo === "x_paga_y") {
                const x = parseInt(sc.valore.x);
                const y = parseInt(sc.valore.y);
                costoGruppo = (Math.floor(g.count / x) * y + (g.count % x)) * g.prezzoBase;
            } else if (sc.tipo === "x_paga_y_fisso") {
                const x = parseInt(sc.valore.x);
                const y = parseFloat(sc.valore.y);
                costoGruppo = (Math.floor(g.count / x) * y) + (g.count % x) * g.prezzoBase;
            }
        }
        totaleExtra += Math.max(0, costoGruppo);
    });

    const extraEl = document.getElementById("totaleExtraCombo");
    if(extraEl) extraEl.innerText = totaleExtra.toFixed(2);

   

    const quantitaTotaleScelta = statoComboCorrente.contorniSelezionati.length;

    piattiAmmessi.forEach(pAmmesso => {
        const occorrenze = statoComboCorrente.contorniSelezionati.filter(c => c.id === pAmmesso.id).length;
        
        let prezzoDaMostrare = pAmmesso.prezzo;
        if (pAmmesso.sconto && pAmmesso.sconto.tipo === "percentuale") {
            prezzoDaMostrare -= (prezzoDaMostrare * (pAmmesso.sconto.valore / 100));
        } else if (pAmmesso.sconto && pAmmesso.sconto.tipo === "fisso") {
            prezzoDaMostrare -= pAmmesso.sconto.valore;
        }
        prezzoDaMostrare = Math.max(0, prezzoDaMostrare);
        
        const btnPrezzoTxt = (quantitaTotaleScelta < maxGratis) ? "GRATIS" : `+€${prezzoDaMostrare.toFixed(2)}`;

        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";
        row.style.padding = "8px 0";
        row.style.borderBottom = "1px solid #eee";

        row.innerHTML = `
            <div style="flex:1;"><b>${pAmmesso.nome}</b> <small style="color:#777;">(€${pAmmesso.prezzo.toFixed(2)})</small></div>
            <div style="display:flex; align-items:center; gap:8px;">
                ${occorrenze > 0 ? `
                    <button onclick="rimuoviContornoCombo('${pAmmesso.id}')" style="background:#ccc; border:none; padding:5px 12px; border-radius:6px; font-weight:bold;">-</button>
                    <span style="font-weight:bold;">${occorrenze}</span>
                ` : ''}
                <button onclick="aggiungiContornoCombo('${pAmmesso.id}')" style="background:#4CAF50; color:white; border:none; padding:5px 10px; border-radius:6px; font-weight:bold;">${occorrenze > 0 ? '+' : btnPrezzoTxt}</button>
            </div>
        `;
        listaDiv.appendChild(row);
    });

    const btnConferma = document.getElementById("btnConfermaCombo");
    if(btnConferma) {
        btnConferma.onclick = () => {
            chiudiPopupCombo();
            let contorniDaSalvare = [];
            statoComboCorrente.contorniSelezionati.forEach((c, index) => {
                contorniDaSalvare.push({
                    id: c.id, 
                    nome: c.nome,
                    prezzoOriginale: c.prezzoBase,
                    prezzoPagato: (index >= maxGratis) ? c.prezzoBase : 0, 
                    isGratis: (index < maxGratis),
                    categoria: window.menuData[c.id]?.categoria || "cibi" // <--- AGGIUNTO QUESTO
                });
            });

            if (statoComboCorrente.contesto === "cassa") {
                // Raggruppa nel carrello se è identico!
                let comboEsistente = comandaCorrente.find(x => 
                    x.nome === piattoCombo.nome && 
                    JSON.stringify(x.contorniScelti || []) === JSON.stringify(contorniDaSalvare) && 
                    (!x.varianti || x.varianti.length === 0)
                );

                if (comboEsistente) {
                    comboEsistente.quantita += 1;
                } else {
                    comandaCorrente.push({
                        nome: piattoCombo.nome, 
                        prezzo: piattoCombo.prezzo, 
                        categoria: piattoCombo.categoria,
                        ingredienti: piattoCombo.ingredienti ? JSON.parse(JSON.stringify(piattoCombo.ingredienti)) : [],
                        varianti: [], 
                        extraPrezzo: totaleExtra, 
                        quantita: 1, 
                        contorniScelti: contorniDaSalvare,
                        sconto: piattoCombo.sconto || null 
                    });
                }
                aggiornaComandaCorrente();
            } else if (statoComboCorrente.contesto === "preordine") {
                if (typeof aggiungiComboCarrelloCliente === "function") {
                    aggiungiComboCarrelloCliente(piattoCombo, null, contorniDaSalvare, totaleExtra);
                }
            }
        };
    }
}

window.aggiungiContornoCombo = function(idPiattino) {
    const p = window.menuData[idPiattino];
    statoComboCorrente.contorniSelezionati.push({ 
        id: idPiattino, // FIX: Mancava l'id!
        nome: p.nome, 
        prezzoBase: p.prezzo 
    });
    renderListaPiattiCombo(window.menuData[statoComboCorrente.piattoId]);
};

window.rimuoviContornoCombo = function(idPiattino) {
    const arr = statoComboCorrente.contorniSelezionati;
    const index = arr.map(e => e.id).lastIndexOf(idPiattino);
    if (index > -1) arr.splice(index, 1);
    renderListaPiattiCombo(window.menuData[statoComboCorrente.piattoId]);
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
      function formattaPiatto(i) {
          let varTxt = "";
          let variantiArray = i.varianti ? (Array.isArray(i.varianti) ? i.varianti : Object.values(i.varianti)) : [];
          
          if (variantiArray.length > 0) {
              let conteggio = {};
              variantiArray.forEach(v => {
                  let key = v.tipo + "_" + v.nome;
                  if (!conteggio[key]) conteggio[key] = { tipo: v.tipo, nome: v.nome, count: 0 };
                  conteggio[key].count++;
              });

              let txt = Object.values(conteggio).map(v => {
                  let qTxt = v.count > 1 ? `${v.count}x ` : "";
                  if (v.tipo === "aggiunta") return `<span style="color:green; font-weight:bold;">+${qTxt}${v.nome}</span>`;
                  else return `<span style="color:red; font-weight:bold;">-${v.nome}</span>`;
              }).join(", ");
              varTxt = ` <span style="font-size:0.85em;">(${txt})</span>`;
          }

          let base = "";
          if (i.isMainHere !== false) {
              base = `${i.quantita}x ${i.nome}${varTxt}`;
          } else {
              base = `<span style="font-style:italic; color:#777;">[Di: ${i.quantita}x ${i.nome}]</span>`;
          }

          if (i.contorniScelti && i.contorniScelti.length > 0) {
              let contorniHtml = i.contorniScelti.map(c => `↳ ${i.quantita}x ${c.nome}`).join("<br>");
              base += `<br><span style="margin-left:15px; font-size:0.9em; color:#333;">${contorniHtml}</span>`;
          }

          return base;
      }

      const piattiCibo = cibo.map(formattaPiatto).join(" | ") || "—";
      const piattiBere = bere.map(formattaPiatto).join(" | ") || "—";
      const piattiSnack = snack.map(formattaPiatto).join(" | ") || "—";

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
		const btnExtra = document.createElement("button");
        btnExtra.innerText = "⚙️ Extra";
        btnExtra.title = "Imposta Prezzo e Quantità per Aggiunte";
        btnExtra.style.marginLeft = "5px";
        btnExtra.onclick = () => {
            // 🔹 NOVITÀ: Peschiamo l'ingrediente aggiornato in tempo reale dal database locale
            // Questo risolve il bug della spunta che salta se riapri la scheda!
            const currentIng = window.ingredientData[ing.id] || ing;

            const defP = currentIng.prezzoExtra !== undefined ? currentIng.prezzoExtra : 0.50;
            const defQ = currentIng.qtyExtra !== undefined ? currentIng.qtyExtra : 1;
            
            // Quali categorie ha già attive?
            const cats = currentIng.categorieApplicabili || [currentIng.categoria || "cibi"];
            const isCibi = cats.includes("cibi") ? "checked" : "";
            const isBevande = cats.includes("bevande") ? "checked" : "";
            const isSnack = cats.includes("snack") ? "checked" : "";
            
            // Controllo se è usabile come extra (usando currentIng!)
            const isExtraChecked = currentIng.usabileComeExtra ? "checked" : "";

            const overlay = document.createElement("div");
            overlay.className = "modal-overlay";
            overlay.style.zIndex = "10005";

            const modal = document.createElement("div");
            modal.className = "modal-varianti";
            modal.innerHTML = `
                <h3>Impostazioni: ${ing.nome}</h3>
                
                <div style="margin-bottom:15px; text-align:left; background: #e8f5e9; padding: 10px; border-radius: 6px; border: 1px solid #c8e6c9;">
                    <label style="cursor:pointer;">
                        <input type="checkbox" id="chkUsabileExtra" ${isExtraChecked} style="transform: scale(1.2); margin-right: 8px;"> 
                        <b>Utilizzabile come variante / aggiunta nei piatti</b>
                    </label>
                </div>

                <div style="margin-bottom:15px; text-align:left;">
                    <label><b>Prezzo Extra (€):</b></label>
                    <input type="number" step="0.01" id="valPrezzo" value="${defP}" style="width:100%; box-sizing:border-box; padding:8px; margin-top:5px;">
                </div>
                
                <div style="margin-bottom:15px; text-align:left;">
                    <label><b>Quantità scalata dal magazzino:</b></label>
                    <input type="number" step="0.1" id="valQty" value="${defQ}" style="width:100%; box-sizing:border-box; padding:8px; margin-top:5px;">
                </div>
                
                <div style="margin-bottom:20px; text-align:left;">
                    <label><b>Mostra come variante per i piatti in:</b></label><br>
                    <div style="margin-top:8px;">
                        <label style="margin-right:15px;"><input type="checkbox" class="chk-cat" value="cibi" ${isCibi}> Cibi</label>
                        <label style="margin-right:15px;"><input type="checkbox" class="chk-cat" value="bevande" ${isBevande}> Bevande</label>
                        <label><input type="checkbox" class="chk-cat" value="snack" ${isSnack}> Snack</label>
                    </div>
                </div>
                
                <div class="modal-actions">
                    <button class="btn-chiudi" id="closeModal">Annulla</button>
                    <button class="btn-salva" id="saveModal">Salva</button>
                </div>
            `;
            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            document.getElementById("closeModal").onclick = () => overlay.remove();
            document.getElementById("saveModal").onclick = () => {
                const p = parseFloat(document.getElementById("valPrezzo").value);
                const q = parseFloat(document.getElementById("valQty").value);
                const usabile = document.getElementById("chkUsabileExtra").checked; // Cattura la spunta
                
                const selectedCats = [];
                document.querySelectorAll(".chk-cat:checked").forEach(cb => selectedCats.push(cb.value));

                db.ref(`ingredienti/${ing.id}`).update({ 
                    prezzoExtra: isNaN(p) ? 0 : p, 
                    qtyExtra: isNaN(q) ? 1 : q,
                    categorieApplicabili: selectedCats,
                    usabileComeExtra: usabile // Salva su database
                });
                overlay.remove();
                notify("Modifiche salvate!", "success");
            };
        };
        // In caricaIngredienti()
		if (window.settings.sistemaExtraAbilitato) {
		    row.appendChild(btnExtra);
		}

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
window.apriModalCreaIngrediente = function() {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "10005";

    const modal = document.createElement("div");
    modal.className = "modal-varianti";
    modal.innerHTML = `
        <h3>Crea Nuovo Ingrediente</h3>
        
        <div style="margin-bottom:15px; text-align:left;">
            <label><b>Nome Ingrediente:</b></label>
            <input type="text" id="modIngNome" placeholder="Es. Maionese, Patatine..." style="width:100%; box-sizing:border-box; padding:8px; margin-top:5px; border-radius:6px; border:1px solid #ccc;">
        </div>

        <div style="margin-bottom:15px; text-align:left; display:flex; gap:10px;">
            <div style="flex:1;">
                <label><b>Categoria:</b></label>
                <select id="modIngCat" style="width:100%; padding:8px; margin-top:5px; border-radius:6px; border:1px solid #ccc;">
                    <option value="cibi">Cibi</option>
                    <option value="bevande">Bevande</option>
                    <option value="snack">Snack</option>
                </select>
            </div>
            <div style="flex:1;">
                <label><b>Unità di misura:</b></label>
                <select id="modIngUnita" style="width:100%; padding:8px; margin-top:5px; border-radius:6px; border:1px solid #ccc;">
                    <option value="">Nessuna</option>
                    <option value="kg">kg</option>
                    <option value="g">g</option>
                    <option value="l">l</option>
                    <option value="ml">ml</option>
                    <option value="pz">pz</option>
                    <option value="Lattina 33cl">Lattina 33cl</option>
                </select>
            </div>
        </div>

        <hr style="margin: 15px 0; border: 0; border-top: 1px solid #ddd;">

        <div style="margin-bottom:15px; text-align:left; background: #e8f5e9; padding: 10px; border-radius: 6px; border: 1px solid #c8e6c9;">
            <label style="cursor:pointer; display:flex; align-items:center;">
                <input type="checkbox" id="modIngExtra" style="transform: scale(1.2); margin-right: 10px;"> 
                <b>Utilizzabile come variante / aggiunta</b>
            </label>
        </div>

        <div style="margin-bottom:15px; text-align:left; display:flex; gap:10px;">
            <div style="flex:1;">
                <label><b>Prezzo Extra (€):</b></label>
                <input type="number" step="0.01" id="modIngPrezzoExtra" value="0.50" style="width:100%; box-sizing:border-box; padding:8px; margin-top:5px; border-radius:6px; border:1px solid #ccc;">
            </div>
            <div style="flex:1;">
                <label><b>Qty scalata magazzino:</b></label>
                <input type="number" step="0.1" id="modIngQtyExtra" value="1" style="width:100%; box-sizing:border-box; padding:8px; margin-top:5px; border-radius:6px; border:1px solid #ccc;">
            </div>
        </div>
        
        <div style="margin-bottom:20px; text-align:left;">
            <label><b>Mostra come variante per i piatti in:</b></label><br>
            <div style="margin-top:8px;">
                <label style="margin-right:15px;"><input type="checkbox" class="mod-chk-cat" value="cibi" checked> Cibi</label>
                <label style="margin-right:15px;"><input type="checkbox" class="mod-chk-cat" value="bevande"> Bevande</label>
                <label><input type="checkbox" class="mod-chk-cat" value="snack"> Snack</label>
            </div>
        </div>
        
        <div class="modal-actions" style="display:flex; justify-content:flex-end; gap:10px;">
            <button class="btn-chiudi" id="closeCreaIng">Annulla</button>
            <button class="btn-salva" id="saveCreaIng">Crea Ingrediente</button>
        </div>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    document.getElementById("closeCreaIng").onclick = () => overlay.remove();
    
    document.getElementById("saveCreaIng").onclick = () => {
        const nome = document.getElementById("modIngNome").value.trim();
        const categoria = document.getElementById("modIngCat").value;
        const unita = document.getElementById("modIngUnita").value;
        
        const usabileComeExtra = document.getElementById("modIngExtra").checked;
        const prezzoExtra = parseFloat(document.getElementById("modIngPrezzoExtra").value) || 0;
        const qtyExtra = parseFloat(document.getElementById("modIngQtyExtra").value) || 1;
        
        const selectedCats = [];
        document.querySelectorAll(".mod-chk-cat:checked").forEach(cb => selectedCats.push(cb.value));
        
        if (!nome) {
            alert("Devi inserire il nome dell'ingrediente!");
            return;
        }

        // Salvataggio nel Database (Firebase)
        const nuovoRef = db.ref("ingredienti").push();
        nuovoRef.set({
            id: nuovoRef.key,
            nome: nome,
            categoria: categoria,
            unita: unita,
            esaurito: false, // Appena creato, di default è disponibile
            usabileComeExtra: usabileComeExtra,
            prezzoExtra: prezzoExtra,
            qtyExtra: qtyExtra,
            categorieApplicabili: selectedCats.length > 0 ? selectedCats : [categoria]
        }).then(() => {
            overlay.remove();
            if (typeof notify === "function") notify("Ingrediente creato con successo!", "success");
        }).catch(err => {
            console.error("Errore salvataggio ingrediente:", err);
            alert("Errore durante il salvataggio.");
        });
    };
};
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
           
            function formattaPiattoAdmin(i) {
                let varTxt = "";
                let variantiArray = i.varianti ? (Array.isArray(i.varianti) ? i.varianti : Object.values(i.varianti)) : [];
                
                if (variantiArray.length > 0) {
                    let conteggio = {};
                    variantiArray.forEach(v => {
                        let key = v.tipo + "_" + v.nome;
                        if (!conteggio[key]) conteggio[key] = { tipo: v.tipo, nome: v.nome, count: 0 };
                        conteggio[key].count++;
                    });

                    let txt = Object.values(conteggio).map(v => {
                        let qTxt = v.count > 1 ? `${v.count}x ` : "";
                        if (v.tipo === "aggiunta") return `<span style="color:green; font-weight:bold;">+${qTxt}${v.nome}</span>`;
                        else return `<span style="color:red; font-weight:bold;">-${v.nome}</span>`;
                    }).join(", ");
                    varTxt = ` <span style="font-size:0.85em;">(${txt})</span>`;
                }

                let base = "";
                if (i.isMainHere !== false) {
                    base = `${i.quantita}x ${i.nome}${varTxt}`;
                } else {
                    base = `<span style="font-style:italic; color:#777;">[Di: ${i.quantita}x ${i.nome}]</span>`;
                }

                if (i.contorniScelti && i.contorniScelti.length > 0) {
                    let contorniHtml = i.contorniScelti.map(c => `↳ ${i.quantita}x ${c.nome}`).join("<br>");
                    base += `<br><span style="margin-left:15px; font-size:0.9em; color:#333;">${contorniHtml}</span>`;
                }

                return base;
            }

            const piattiCibo = cibo.map(formattaPiattoAdmin).join(" <br> ") || "—";
            const piattiBere = bere.map(formattaPiattoAdmin).join(" <br> ") || "—";
            const piattiSnack = snack && snack.length ? snack.map(formattaPiattoAdmin).join(" <br> ") : null;

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
// ================= MODIFICA COMANDA ADMIN (A MODALE) =================
function modificaComanda(id, comanda) {
    if (!checkOnline(true)) return;

    // Crea l'overlay per il modale della modifica comanda
    const overlayEdit = document.createElement("div");
    overlayEdit.className = "modal-overlay";
    overlayEdit.style.zIndex = "9999"; // Sotto al modale delle varianti, ma sopra al resto

    const divAdmin = document.createElement("div");
    divAdmin.className = "modal-varianti";
    divAdmin.style.maxWidth = "700px"; // Più largo per contenere bene il menu
    divAdmin.style.width = "95%";
    divAdmin.style.maxHeight = "90vh";
    divAdmin.style.overflowY = "auto";
    divAdmin.style.textAlign = "left";
    divAdmin.id = "admin_edit_comanda_" + id;

    // Copia locale della comanda (modifiche rimangono locali finché non salvi)
    let comandaTemp = JSON.parse(JSON.stringify(comanda));

    // Tracker del magazzino (per ripristino se clicchi Annulla)
    const reserved = {}; 
    function addReserved(id, qty) { reserved[id] = (reserved[id] || 0) + qty; }
    function subReserved(id, qty) { reserved[id] = Math.max(0, (reserved[id] || 0) - qty); }

    // HEADER
    const header = document.createElement("h3");
    header.innerText = `Modifica Comanda #${comanda.numero}`;
    header.style.textAlign = "center";
    header.style.marginBottom = "15px";
    divAdmin.appendChild(header);

    // LISTA PIATTI + TOTALE
    const listaPiatti = document.createElement("div");
    divAdmin.appendChild(listaPiatti);
    const totDiv = document.createElement("div");
    totDiv.style.fontSize = "1.2rem";
    totDiv.style.textAlign = "right";
    totDiv.style.marginBottom = "15px";
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
            r.style.padding = "8px 0";
            r.style.borderBottom = "1px solid #eee";

            const info = document.createElement("span");
            info.style.flex = "1";
            info.style.cursor = "pointer"; // Indica che è cliccabile per varianti
            info.title = "Clicca per aggiungere/rimuovere varianti";

            let infoText;
            const prezzoPiattoAttuale = (p.prezzo + (p.extraPrezzo || 0));

            if (p.sconto) {
                if (p.sconto.tipo === "percentuale") {
                    infoText = `<b>${p.quantita}x ${p.nome}</b> ` +
                        `<span style="text-decoration: line-through; color:red;">€${prezzoPiattoAttuale.toFixed(2)}</span> ` +
                        `<span style="color:red;">€${(calcolaPrezzoConSconto(p)/p.quantita).toFixed(2)}</span>`;
                } else if (p.sconto.tipo === "x_paga_y") {
                    infoText = `<b>${p.quantita}x ${p.nome}</b> (€${(calcolaPrezzoConSconto(p)/p.quantita).toFixed(2)})`;
                } else {
                    infoText = `<b>${p.quantita}x ${p.nome}</b> (€${prezzoPiattoAttuale.toFixed(2)})`;
                }
            } else {
                infoText = `<b>${p.quantita}x ${p.nome}</b> (€${prezzoPiattoAttuale.toFixed(2)})`;
            }

            // Aggiunta delle scritte colorate per le varianti
            let variantiHtml = "";
            if (p.varianti && p.varianti.length > 0) {
                variantiHtml = "<br><small style='font-weight:bold;'>" + p.varianti.map(v => 
                    v.tipo === "aggiunta" ? `<span style="color:green">+ ${v.nome}</span>` : `<span style="color:red">- Senza ${v.nome}</span>`
                ).join("<br>") + "</small>";
            }

            info.innerHTML = infoText + variantiHtml;
            // APRE IL POPUP DELLE VARIANTI!
            if (window.settings.sistemaExtraAbilitato) {
    			info.onclick = () => apriPopupVariantiAdmin(idx, comandaTemp, reserved, aggiornaLista);
			    info.title = "Clicca per aggiungere/rimuovere varianti";
			} else {
			    info.onclick = null;
			    info.style.cursor = "default";
			    info.title = "";
			}

            const controls = document.createElement("span");
            controls.style.marginLeft = "10px";

            const btnMinus = document.createElement("button");
            btnMinus.innerText = "-";
            btnMinus.className = "tabBtn";
            btnMinus.onclick = async () => {
                if (p.quantita > 1) {
                    getIngredientiEffettivi(p).forEach(async i => {
                        const qty = i.qty || 1;
                        if (i.id) { await applicaIncrementoSingolo(i.id, qty); subReserved(i.id, qty); }
                        else {
                            const nameLow = (i.nome||"").trim().toLowerCase();
                            const mapped = Object.keys(ingredientData).find(k => (ingredientData[k].nome||"").trim().toLowerCase() === nameLow);
                            if (mapped) { await applicaIncrementoSingolo(mapped, qty); subReserved(mapped, qty); }
                        }
                    });
                    p.quantita--;
                } else {
                    getIngredientiEffettivi(p).forEach(async i => {
                        const qty = (i.qty || 1) * 1;
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
            btnPlus.className = "tabBtn";
            btnPlus.style.marginLeft = "6px";
            btnPlus.onclick = async () => {
                const delta = 1;
                const richiesteDelta = calcolaRichiesteDaPiatti([ { ingredienti: p.ingredienti || [], varianti: p.varianti || [], quantita: delta } ]);
                btnPlus.disabled = true;
                const r = await applicaDecrementiIngredienti(richiesteDelta);
                btnPlus.disabled = false;
                if (!r.success) { notify("Non c'è abbastanza disponibilità: " + (r.message||""), "error"); return; }
                p.quantita++;
                
                getIngredientiEffettivi(p).forEach(i => {
                    if (i.id) addReserved(i.id, i.qty || 1);
                    else {
                        const nameLow = (i.nome||"").trim().toLowerCase();
                        const mapped = Object.keys(ingredientData).find(k => (ingredientData[k].nome||"").trim().toLowerCase() === nameLow);
                        if (mapped) addReserved(mapped, i.qty || 1);
                    }
                });
                aggiornaLista();
            };

            const btnRemove = document.createElement("button");
            btnRemove.innerText = "X";
			btnRemove.style.marginLeft = "6px";
			btnRemove.style.color = "#000000"; // Nero
			btnRemove.style.fontWeight = "900"; // Grassetto marcato
			btnRemove.style.backgroundColor = "#ffcccc"; // Sfondo rosso chiaro per contrasto
            btnRemove.className = "tabBtn";
            btnRemove.onclick = async () => {
                getIngredientiEffettivi(p).forEach(async i => {
                    const qty = (i.qty || 1) * (p.quantita || 1);
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

    // MENU PICKER
    const menuPickDiv = document.createElement("div");
    menuPickDiv.innerHTML = "<h4 style='margin-bottom:10px;'>Aggiungi dal Menu</h4>";
    const loading = document.createElement("div");
    loading.innerText = "Caricamento menu...";
    menuPickDiv.appendChild(loading);
    divAdmin.appendChild(menuPickDiv);

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
                    return { available: false, reason: `${ing.nome} insuff. (${ing.rimanente})` };
                }
            }
        }
        return { available: true, reason: null };
    }

    const menuRef = db.ref("menu");
    const ingRef = db.ref("ingredienti");
    const menuButtons = {}; 
    divAdmin._ingredientiListener = null;

    menuRef.once("value").then(menuSnap => {
        const menuData = menuSnap.val() || {};
        const ingListenerFn = ingRef.on("value", ingSnap => {
            const ingData = ingSnap.val() || {};
            if (loading.parentNode) loading.parentNode.removeChild(loading);

            for (const mid in menuData) {
                const mp = menuData[mid];
                if (!mp || !mp.nome) continue;

                let b = menuButtons[mid];
                if (!b) {
                    b = document.createElement("button");
                    b.className = "piatto-btn";
                    b.style.margin = "4px";
                    b.style.display = "inline-block";
                    b.style.width = "auto";
                    b.style.padding = "8px 12px";

                    if (mp.bloccato === true) {
                        b.disabled = true;
                        b.style.opacity = 0.5;
                    }

                    const prezzoDiv = document.createElement("span");
                    prezzoDiv.style.display = "block";
                    prezzoDiv.style.fontSize = "0.85em";
                    prezzoDiv.style.marginTop = "2px";
                    
                    if (mp.sconto) {
                        if (mp.sconto.tipo === "percentuale") {
                            prezzoDiv.innerHTML = `<span style="text-decoration: line-through;">€${mp.prezzo.toFixed(2)}</span> €${calcolaPrezzoConSconto(mp).toFixed(2)}`;
                        } else {
                            prezzoDiv.innerText = `€${calcolaPrezzoConSconto(mp).toFixed(2)}`;
                        }
                    } else {
                        prezzoDiv.innerText = `€${mp.prezzo.toFixed(2)}`;
                    }
                    b.innerHTML = `<b>${mp.nome}</b>`;
                    b.appendChild(prezzoDiv);

                    b.onclick = async () => {
                        if (mp.bloccato === true) { notify("Piatto bloccato", "error"); return; }
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
                        if (!decRes.success) { notify("Impossibile aggiungere: " + (decRes.message || "ingredienti"), "error"); return; }

                        if (!comandaTemp.piatti) comandaTemp.piatti = [];
                        const esiste = comandaTemp.piatti.find(p => p.nome === mp.nome && (!p.varianti || p.varianti.length === 0));
                        if (esiste) { 
                            if (!esiste.prezziSingoli) esiste.prezziSingoli = Array(esiste.quantita).fill(esiste.prezzo);
                            esiste.prezziSingoli.push(mp.prezzo);
                            esiste.quantita++;
                        } else {
                            comandaTemp.piatti.push({
                                nome: mp.nome, prezzo: mp.prezzo, quantita: 1, prezziSingoli: [mp.prezzo],
                                categoria: mp.categoria || "altro", sconto: mp.sconto || null,
                                tipo: mp.tipo || (mp.categoria && mp.categoria.toLowerCase().includes("snack") ? "snack" : "cucina"),
                                ingredienti: mp.ingredienti ? JSON.parse(JSON.stringify(mp.ingredienti)) : [],
								maxVariantiGratis: mp.maxVariantiGratis || 0
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

                if (mp.bloccato === true) {
                    b.disabled = true; b.style.opacity = 0.5;
                } else {
                    const check = verificaDisponibilitaMenuItem(mp, ingData, 1);
                    if (!check.available) {
                        b.disabled = true; b.style.opacity = 0.6;
                    } else {
                        b.disabled = false; b.style.opacity = 1;
                    }
                }
            }
        });

        divAdmin._ingredientiListener = { ref: ingRef, fn: ingListenerFn };
    }).catch(err => console.error(err));

    // AZIONI SALVA / ANNULLA
    const azioniDiv = document.createElement("div");
    azioniDiv.className = "modal-actions";
    azioniDiv.style.marginTop = "25px";

    const btnAnnulla = document.createElement("button");
    btnAnnulla.className = "btn-chiudi";
    btnAnnulla.innerText = "Annulla";
    btnAnnulla.onclick = async () => {
        try {
            if (Object.keys(reserved).length > 0) { await applicaIncrementiIngredienti(reserved); }
        } catch (e) {}
        overlayEdit.remove();
    };

    const btnSalva = document.createElement("button");
    btnSalva.className = "btn-salva";
    btnSalva.innerText = "Salva";
    btnSalva.onclick = async () => {
        try {
            if (!comandaTemp.piatti || comandaTemp.piatti.length === 0) {
                await db.ref("comande/" + id).remove();
            } else {
                const ciboNuovo = comandaTemp.piatti.some(p => p.categoria !== "bevande" && !p.categoria.toLowerCase().includes("snack"));
                const bereNuovo = comandaTemp.piatti.some(p => p.categoria === "bevande");
                const snackNuovo = comandaTemp.piatti.some(p => (p.categoria && (p.categoria.toLowerCase().includes("snack") || p.categoria.toLowerCase().includes("fritti"))) || (p.tipo && p.tipo.toLowerCase() === "snack"));

                const updateData = { piatti: comandaTemp.piatti, statoCucina: ciboNuovo ? "da fare" : "completato", statoBere: bereNuovo ? "da fare" : "completato" };
                if (snackNuovo) updateData.statoSnack = "da fare";
                else updateData.statoSnack = null;

                await db.ref("comande/" + id).update(updateData);
                if (!snackNuovo) await db.ref("comande/" + id + "/statoSnack").remove();
            }
            overlayEdit.remove();
            notify("Comanda aggiornata!", "success");
        } catch(err){
            notify("Errore salvataggio: " + err.message, "error");
        }
    };

    azioniDiv.appendChild(btnAnnulla);
    azioniDiv.appendChild(btnSalva);
    divAdmin.appendChild(azioniDiv);

    overlayEdit.appendChild(divAdmin);
    document.body.appendChild(overlayEdit);
}
// ================= POPUP VARIANTI ESCLUSIVO PER ADMIN =================
function apriPopupVariantiAdmin(idx, comandaTemp, reserved, callback) {
    const piatto = comandaTemp.piatti[idx];
    
    // DIVISIONE AUTOMATICA PER PIATTI MULTIPLI
    if (piatto.quantita > 1) {
        piatto.quantita -= 1;
        const piattoSingolo = JSON.parse(JSON.stringify(piatto));
        piattoSingolo.quantita = 1;
        piattoSingolo.varianti = [];
        piattoSingolo.extraPrezzo = 0;
        comandaTemp.piatti.splice(idx + 1, 0, piattoSingolo);
        callback();
        apriPopupVariantiAdmin(idx + 1, comandaTemp, reserved, callback);
        return;
    }

    if (!piatto.varianti) piatto.varianti = [];
    if (!piatto.extraPrezzo) piatto.extraPrezzo = 0;

    let tempVarianti = JSON.parse(JSON.stringify(piatto.varianti));
    let tempExtraPrezzo = piatto.extraPrezzo;

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "10005"; 

    const modal = document.createElement("div");
    modal.className = "modal-varianti";
    
    let maxGratis = piatto.maxVariantiGratis || 0;
	// Sistema anti-errore: se il dato manca, lo peschiamo dal menu originale
	if (!maxGratis && window.menuData) {
	    const piattoOriginale = Object.values(window.menuData).find(m => m.nome === piatto.nome);
	    if (piattoOriginale && piattoOriginale.maxVariantiGratis) {
	        maxGratis = parseInt(piattoOriginale.maxVariantiGratis);
	        piatto.maxVariantiGratis = maxGratis; // Lo salva nello scontrino per non doverlo ricaricare
	    }
	}
    const testoGratis = maxGratis > 0 ? `<br><small style="color:green; font-size:0.75em;">(Promozione: Hai ${maxGratis} aggiunte GRATIS!)</small>` : "";

    const titolo = document.createElement("h3");
    titolo.innerHTML = `Modifica: ${piatto.nome} ${testoGratis}`;
    modal.appendChild(titolo);

    const listaDiv = document.createElement("div");

    // STESSO CERVELLO DELLA CASSA
    function ricalcolaExtraPrezzo() {
        let totaleExtra = 0;
        const aggiunte = tempVarianti.filter(v => v.tipo === "aggiunta");
        aggiunte.forEach((v, index) => {
            if (index >= maxGratis) totaleExtra += Number(v.prezzo || 0);
        });
        tempExtraPrezzo = totaleExtra;
    }

    function renderListaIngredienti() {
        ricalcolaExtraPrezzo(); // Ricalcola ad ogni click
        
        const aggiunteFatte = tempVarianti.filter(v => v.tipo === "aggiunta").length;
        const isProssimaGratis = aggiunteFatte < maxGratis;

        listaDiv.innerHTML = "";
        // FIX: Recuperiamo sia gli ID che i nomi esatti per compatibilità con i piatti vecchi
        const baseIds = (piatto.ingredienti || []).map(i => i.id).filter(id => id);
        const baseNomi = (piatto.ingredienti || []).map(i => (i.nome || "").trim().toLowerCase());

        Object.entries(window.ingredientData || {}).forEach(([id, ing]) => {
            const catsApp = ing.categorieApplicabili || [ing.categoria || "cibi"];
            
            // FIX: Se un piatto vecchio ha la vecchia categoria "cucina", la convertiamo in "cibi"
            let catPiatto = (piatto.categoria || "cibi").toLowerCase();
            if (catPiatto === "cucina") catPiatto = "cibi"; 

            // Riconosce l'ingrediente base sia dall'ID che dal nome
            const isBase = baseIds.includes(id) || baseNomi.includes((ing.nome || "").trim().toLowerCase());
            const isExtraFlag = (ing.usabileComeExtra === true) && catsApp.includes(catPiatto);

            let allowRemove = false;
            let allowAdd = false;

            if (window.settings.sistemaExtraAbilitato) {
                if (isBase) allowRemove = true;
                if (isExtraFlag) allowAdd = true;
            } else {
                if (isBase && isExtraFlag) allowRemove = true;
            }

            if (!allowRemove && !allowAdd) return; 

            const row = document.createElement("div");
            row.className = "variante-row";
            const nomeSpan = document.createElement("span");
            nomeSpan.innerText = ing.nome;
            const btnContainer = document.createElement("div");

            if (allowRemove) {
                const btnRemove = document.createElement("button");
                const isRimosso = tempVarianti.some(v => v.tipo === "rimozione" && v.id === id);
                if (isRimosso) {
                    btnRemove.className = "variante-btn disabled";
                    btnRemove.innerText = "Annulla Rimozione";
                    btnRemove.onclick = () => {
                        tempVarianti = tempVarianti.filter(v => !(v.tipo === "rimozione" && v.id === id));
                        renderListaIngredienti();
                    };
                } else {
                    btnRemove.className = "variante-btn remove";
                    btnRemove.innerText = "- Rimuovi";
                    btnRemove.onclick = () => {
                        tempVarianti.push({ tipo: "rimozione", id: id, nome: ing.nome });
                        renderListaIngredienti();
                    };
                }
                btnContainer.appendChild(btnRemove);
            }

            if (allowAdd) {
                const costoExtra = ing.prezzoExtra !== undefined ? Number(ing.prezzoExtra) : 0.50; 
                const qtyExtra = ing.qtyExtra !== undefined ? Number(ing.qtyExtra) : 1;
                const occorrenze = tempVarianti.filter(v => v.tipo === "aggiunta" && v.id === id).length;

                const wrapperAdd = document.createElement("div");
                wrapperAdd.style.display = "inline-flex"; wrapperAdd.style.alignItems = "center"; wrapperAdd.style.marginLeft = "5px";

                if (occorrenze > 0) {
                    const btnMinus = document.createElement("button"); btnMinus.className = "variante-btn remove"; btnMinus.innerText = "-"; btnMinus.style.padding = "4px 10px";
                    btnMinus.onclick = () => {
                        const reversedIndex = [...tempVarianti].reverse().findIndex(v => v.tipo === "aggiunta" && v.id === id);
                        if (reversedIndex !== -1) tempVarianti.splice(tempVarianti.length - 1 - reversedIndex, 1);
                        renderListaIngredienti();
                    };
                    const spanCount = document.createElement("span"); spanCount.innerText = occorrenze; spanCount.style.margin = "0 8px"; spanCount.style.fontWeight = "bold";
                    const btnPlus = document.createElement("button"); btnPlus.className = "variante-btn add"; btnPlus.innerText = "+"; btnPlus.style.padding = "4px 10px";
                    btnPlus.onclick = () => { tempVarianti.push({ tipo: "aggiunta", id: id, nome: ing.nome, qty: qtyExtra, prezzo: costoExtra }); renderListaIngredienti(); };

                    wrapperAdd.appendChild(btnMinus); wrapperAdd.appendChild(spanCount); wrapperAdd.appendChild(btnPlus);
                } else {
                    const btnAdd = document.createElement("button"); btnAdd.className = "variante-btn add";
                    btnAdd.innerText = isProssimaGratis ? `+ Aggiungi (GRATIS)` : `+ Aggiungi (€${costoExtra.toFixed(2)})`;
                    btnAdd.onclick = () => { tempVarianti.push({ tipo: "aggiunta", id: id, nome: ing.nome, qty: qtyExtra, prezzo: costoExtra }); renderListaIngredienti(); };
                    wrapperAdd.appendChild(btnAdd);
                }
                btnContainer.appendChild(wrapperAdd);
            }
            row.appendChild(nomeSpan); row.appendChild(btnContainer); listaDiv.appendChild(row);
        });
    }
    renderListaIngredienti();
    modal.appendChild(listaDiv);

    const actionDiv = document.createElement("div");
    actionDiv.className = "modal-actions";

    const btnAnnulla = document.createElement("button");
    btnAnnulla.className = "btn-chiudi";
    btnAnnulla.innerText = "Annulla";
    btnAnnulla.onclick = () => overlay.remove();

    const btnSalva = document.createElement("button");
    btnSalva.className = "btn-salva";
    btnSalva.innerText = "Salva";
    btnSalva.onclick = async () => {
        btnSalva.disabled = true;
        btnSalva.innerText = "Attendere...";

        const oldEff = getIngredientiEffettivi(piatto);
        
        const newPiattoMock = JSON.parse(JSON.stringify(piatto));
        newPiattoMock.varianti = tempVarianti;
        const newEff = getIngredientiEffettivi(newPiattoMock);

        const deltaDb = {};
        newEff.forEach(ing => {
            const id = ing.id || Object.keys(window.ingredientData).find(k => (window.ingredientData[k].nome||"").trim().toLowerCase() === (ing.nome||"").trim().toLowerCase());
            if (id) deltaDb[id] = (deltaDb[id] || 0) + (ing.qty * piatto.quantita);
        });
        oldEff.forEach(ing => {
            const id = ing.id || Object.keys(window.ingredientData).find(k => (window.ingredientData[k].nome||"").trim().toLowerCase() === (ing.nome||"").trim().toLowerCase());
            if (id) deltaDb[id] = (deltaDb[id] || 0) - (ing.qty * piatto.quantita);
        });

        for (const [key, diff] of Object.entries(deltaDb)) {
            if (diff > 0) {
                const res = await applicaDecrementiIngredienti({ byId: { [key]: diff }, byName: {} });
                if (!res.success) {
                    notify("Disponibilità insufficiente per le varianti", "error");
                    btnSalva.disabled = false; btnSalva.innerText = "Salva"; return;
                }
                reserved[key] = (reserved[key] || 0) + diff;
            } else if (diff < 0) {
                await applicaIncrementoSingolo(key, Math.abs(diff));
                reserved[key] = Math.max(0, (reserved[key] || 0) - Math.abs(diff));
            }
        }

        piatto.varianti = tempVarianti;
        piatto.extraPrezzo = tempExtraPrezzo;
        overlay.remove();
        if (callback) callback();
    };

    actionDiv.appendChild(btnAnnulla);
    actionDiv.appendChild(btnSalva);
    modal.appendChild(actionDiv);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}
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
                items = snack; // 🔹 FIX: Usa l'array "snack" già elaborato da separaComanda, che include i contorni estratti!
                
                // 🔹 ORDINA ITEMS secondo toggle nuoveInAltoSnack
                if (window.settings.nuoveInAltoSnack) {
                    items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)); // nuove in cima
                } else {
                    items.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)); // nuove in fondo
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

            if(items.length === 0) {
                listaDiv.innerText = "—";
            } else {
                items.forEach(i => {
                    const pContainer = document.createElement("div");
                    pContainer.style.marginBottom = "8px"; // Distanzia un po' le portate
                    
                    const isActiveState = ((ruolo === "cucina" || ruolo === "bere" || (ruolo === "snack" && snackAbilitato)) && (c[statoKey] === "da fare" || c[statoKey] === "in elaborazione"));
                    const isDisabled = (c[statoKey] === "da fare");
                    const comandaId = id;

                   // --- 1. RENDERING PIATTO PRINCIPALE (se inviato a questo profilo) ---
                    if (i.isMainHere !== false) {
                        const mainDiv = document.createElement("div");
                        mainDiv.style.display = "flex";          
                        mainDiv.style.alignItems = "flex-start";
                        mainDiv.style.marginBottom = "4px";
                        
                        let variantiHtml = "";
                        let varArr = i.varianti ? (Array.isArray(i.varianti) ? i.varianti : Object.values(i.varianti)) : [];
                        let nomePulito = i.nome || "";

                        // 🔥 FIX DEFINITIVO: Puliamo il nome e creiamo l'extra grafico anche quando il contorno diventa "Piatto Principale" nello Snack!
                        const regex = /\s*\(([\+\-].*?)\)/;
                        const match = nomePulito.match(regex);
                        
                        if (match) {
                            // 1. Togliamo l'extra scritto male dal nome (es: "Patatine Fritte [di Hamburger]")
                            nomePulito = nomePulito.replace(regex, "").trim(); 
                            
                            // 2. Trasformiamo la scritta nel bottone verde/rosso
                            if (varArr.length === 0) {
                                let estratti = match[1].split(","); 
                                estratti.forEach(ex => {
                                    ex = ex.trim();
                                    if (ex.startsWith("+")) {
                                        varArr.push({ tipo: "aggiunta", nome: ex.substring(1).trim() });
                                    } else if (ex.startsWith("-")) {
                                        let n = ex.substring(1).trim();
                                        if (n.toLowerCase().startsWith("senza ")) n = n.substring(6).trim();
                                        varArr.push({ tipo: "rimozione", nome: n });
                                    }
                                });
                            }
                        }
                        
                        if (varArr.length > 0) {
                            let conteggio = {};
                            varArr.forEach(v => {
                                if (!v || !v.tipo) return;
                                let key = v.tipo + "_" + v.nome;
                                if (!conteggio[key]) conteggio[key] = { tipo: v.tipo, nome: v.nome, count: 0 };
                                conteggio[key].count++;
                            });

                            // Grafica compatta e pulita
                            variantiHtml = Object.values(conteggio).map(v => {
                                let nomeExtra = v.nome.charAt(0).toUpperCase() + v.nome.slice(1);
                                return v.tipo === "aggiunta" 
                                    ? `<div style="margin-top:2px;"><small style="color:green; font-weight:bold; margin-left:10px;">+ ${v.count > 1 ? v.count + 'x ' : ''}${nomeExtra}</small></div>` 
                                    : `<div style="margin-top:2px;"><small style="color:red; font-weight:bold; margin-left:10px;">- Senza ${nomeExtra}</small></div>`
                            }).join("");
                        }

                        // --- LOGICA CHECKBOX (INVARIATA) ---
                        if (isActiveState) {
                            const box = document.createElement("input");
                            box.type = "checkbox";
                            box.className = "tickItem";
                            box.style.marginRight = "10px";
                            box.style.marginTop = "3px"; 
                            
                            if (!window.tickState) window.tickState = {};
                            if (!window.tickState[comandaId]) window.tickState[comandaId] = {};
                            // Usiamo il nome originale come chiave per non far saltare le spunte salvate
                            const voceKey = `${i.nome}-${i.quantita}-main`;
                            if (window.tickState[comandaId][voceKey] === undefined) window.tickState[comandaId][voceKey] = false;
                            
                            box.checked = window.tickState[comandaId][voceKey];
                            box.disabled = isDisabled;

                            box.addEventListener("change", () => {
                                window.tickState[comandaId][voceKey] = box.checked;
                                const checkboxes = d.querySelectorAll(".tickItem");
                                if (bComp) bComp.disabled = ![...checkboxes].every(cb => cb.checked);
                            });
                            mainDiv.appendChild(box);
                        }

                        const textDiv = document.createElement("div");
                        textDiv.style.display = "flex";
                        textDiv.style.flexDirection = "column";

                        // 🔥 Usiamo nomePulito al posto di i.nome
                        textDiv.innerHTML = `<span> ${i.quantita}x ${nomePulito}</span>${variantiHtml}`;

                        if (i.note && i.note.trim() !== "") {
                            textDiv.innerHTML += `<div style="margin-top:2px;"><small style="color:#d9534f; margin-left:10px;">📝 Note: ${i.note}</small></div>`;
                        }

                        mainDiv.appendChild(textDiv);
                        pContainer.appendChild(mainDiv);
                        
                    } else {
                        // Il piatto principale è altrove, mettiamo un testo di contesto
                        const ctxDiv = document.createElement("div");
                        ctxDiv.innerHTML = `<small style="color:#777;"><i>[Contorno di: ${i.quantita}x ${i.nome}]</i></small>`;
                        pContainer.appendChild(ctxDiv);
                    }

                    // --- 2. RENDERING CONTORNI (Giustificati + Loro Checkbox) ---
                    let contorniArr = i.contorniScelti ? (Array.isArray(i.contorniScelti) ? i.contorniScelti : Object.values(i.contorniScelti)) : [];
                    
                    if (contorniArr.length > 0) {
                        contorniArr.forEach((contorno, cIdx) => {
                            const cDiv = document.createElement("div");
                            cDiv.style.marginLeft = "25px"; // Giustificato!
                            cDiv.style.marginTop = "4px";
                            cDiv.style.display = "flex";
                            cDiv.style.alignItems = "flex-start";

                            // 🔥 NUOVO FIX: Estrae le varianti incastrate nel nome come testo " (+ maionese)"
                            let nomePulito = contorno.nome || "";
                            let varContArr = contorno.varianti ? (Array.isArray(contorno.varianti) ? contorno.varianti : Object.values(contorno.varianti)) : [];
                            
                            // Il "cacciatore" di parentesi: cerca qualsiasi cosa scritta tra parentesi che inizi con + o -
                            const regex = /\s*\(([\+\-].*?)\)/;
                            const match = nomePulito.match(regex);
                            
                            if (match) {
                                // 1. Togliamo la parte brutta dal nome (es: "Patatine fritte" resta pulito)
                                nomePulito = nomePulito.replace(regex, "").trim(); 
                                
                                // 2. Se le varianti non erano nell'array, le convertiamo magicamente noi!
                                if (varContArr.length === 0) {
                                    let estratti = match[1].split(","); // Gestisce anche extra multipli separati da virgola
                                    estratti.forEach(ex => {
                                        ex = ex.trim();
                                        if (ex.startsWith("+")) {
                                            varContArr.push({ tipo: "aggiunta", nome: ex.substring(1).trim() });
                                        } else if (ex.startsWith("-")) {
                                            let n = ex.substring(1).trim();
                                            if (n.toLowerCase().startsWith("senza ")) n = n.substring(6).trim();
                                            varContArr.push({ tipo: "rimozione", nome: n });
                                        }
                                    });
                                }
                            }

                            let variantiContHtml = "";
                            
                            if (varContArr.length > 0) {
                                let conteggioC = {};
                                varContArr.forEach(v => {
                                    if (!v || !v.tipo) return;
                                    let key = v.tipo + "_" + v.nome;
                                    if (!conteggioC[key]) conteggioC[key] = { tipo: v.tipo, nome: v.nome, count: 0 };
                                    conteggioC[key].count++;
                                });

                                variantiContHtml = Object.values(conteggioC).map(v => {
                                    // Mette la prima lettera maiuscola per eleganza (es: maionese -> Maionese)
                                    let nomeExtra = v.nome.charAt(0).toUpperCase() + v.nome.slice(1);
                                    return v.tipo === "aggiunta" 
                                        ? `<div style="margin-top:2px;"><small style="color:green; font-weight:bold; margin-left:10px;">+ ${v.count > 1 ? v.count + 'x ' : ''}${nomeExtra}</small></div>` 
                                        : `<div style="margin-top:2px;"><small style="color:red; font-weight:bold; margin-left:10px;">- Senza ${nomeExtra}</small></div>`
                                }).join("");
                            }

                            if (isActiveState && window.settings && window.settings.checkContorniSingoli) {
                                const cBox = document.createElement("input");
                                cBox.type = "checkbox";
                                cBox.className = "tickItem";
                                cBox.style.marginRight = "10px";
                                cBox.style.marginTop = "3px";

                                if (!window.tickState) window.tickState = {};
                                if (!window.tickState[comandaId]) window.tickState[comandaId] = {};
                                // Usiamo il nome originale come chiave per non far "dimenticare" le spunte salvate
                                const cVoceKey = `${contorno.nome}-${cIdx}-cont`; 
                                if (window.tickState[comandaId][cVoceKey] === undefined) window.tickState[comandaId][cVoceKey] = false;
                                
                                cBox.checked = window.tickState[comandaId][cVoceKey];
                                cBox.disabled = isDisabled;

                                cBox.addEventListener("change", () => {
                                    window.tickState[comandaId][cVoceKey] = cBox.checked;
                                    const checkboxes = d.querySelectorAll(".tickItem");
                                    if (bComp) bComp.disabled = ![...checkboxes].every(cb => cb.checked);
                                });
                                cDiv.appendChild(cBox);
                            }

                            const cTextDiv = document.createElement("div");
                            cTextDiv.style.display = "flex";
                            cTextDiv.style.flexDirection = "column";
                            // 🔥 Usiamo il nomePulito e gli passiamo la nuova grafica!
                            cTextDiv.innerHTML = `<span> ↳ ${nomePulito}</span>${variantiContHtml}`;
                            
                            cDiv.appendChild(cTextDiv);
                            pContainer.appendChild(cDiv);
                        });
                    }

                    listaDiv.appendChild(pContainer);
                });
            }
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
    document.getElementById("aggiungiMenuBtn").onclick = () => {
	    if (!checkOnline(true)) return;
	    
	    const overlay = document.createElement("div");
	    overlay.className = "modal-overlay";
	    overlay.style.zIndex = "10005";
	
	    const modal = document.createElement("div");
	    modal.className = "modal-varianti";
	    modal.style.maxWidth = "600px";
	    modal.style.width = "95%";
	    modal.style.maxHeight = "90vh";
	    modal.style.overflowY = "auto";
	    modal.style.textAlign = "left";
	
	    modal.innerHTML = `
	        <h3 style="text-align: center; margin-bottom: 20px;">➕ Aggiungi Nuovo Piatto</h3>
	        <div style="margin-bottom: 12px;">
	            <label><b>Nome Piatto:</b></label>
	            <input type="text" id="modalPiattoNome" style="width: 100%; padding: 8px; box-sizing: border-box; margin-top: 4px; border: 1px solid #ccc; border-radius: 4px;">
	        </div>
	        <div style="margin-bottom: 12px; display: flex; gap: 10px;">
	            <div style="flex: 1;">
	                <label><b>Prezzo (€):</b></label>
	                <input type="number" id="modalPiattoPrezzo" step="0.01" style="width: 100%; padding: 8px; box-sizing: border-box; margin-top: 4px; border: 1px solid #ccc; border-radius: 4px;">
	            </div>
	            <div style="flex: 1;">
	                <label><b>Categoria:</b></label>
	                <select id="modalPiattoCat" style="width: 100%; padding: 8px; box-sizing: border-box; margin-top: 4px; height: 37px; border: 1px solid #ccc; border-radius: 4px;">
	                    <option value="cibi">Cibi</option>
	                    <option value="bevande">Bevande</option>
	                    <option value="snack">Snack</option>
	                </select>
	            </div>
	        </div>
	        <div style="margin-bottom: 15px;">
	            <label><b>Aggiunte max gratuite:</b></label>
	            <input type="number" id="modalPiattoMaxGratis" min="0" placeholder="0 (Nessuna gratuità)" style="width: 100%; padding: 8px; box-sizing: border-box; margin-top: 4px; border: 1px solid #ccc; border-radius: 4px;">
	        </div>

           <div style="background: #f4f9f4; padding: 15px; border: 1px solid #d0e8d0; border-radius: 8px; margin-bottom: 15px; box-sizing: border-box;">
                <label style="cursor:pointer; display:flex; align-items:center; gap: 10px;">
                    <input type="checkbox" id="modalPiattoIsCombo" style="transform: scale(1.3);" onchange="document.getElementById('comboSettingsNew').style.display = this.checked ? 'block' : 'none';"> 
                    <b style="color: #2e7d32; font-size: 1.1em; margin: 0;">È un Piatto Combo (Menu)?</b>
                </label>
                
                <div id="comboSettingsNew" style="display:none; margin-top:15px; padding-top: 15px; border-top: 1px dashed #c8e6c9;">
                    <label style="display:block; margin-bottom: 5px;"><b>N° Contorni Gratis inclusi:</b></label>
                    <input type="number" id="modalPiattoMaxContorniGratis" value="0" min="0" style="width:100%; padding: 10px; margin-bottom: 15px; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box;">
                    
                    <label style="display:block; margin-bottom: 5px;"><b>Seleziona i piatti ammessi nel Menu:</b></label>
                    <div id="modalPiattoDishesCombo" style="min-height: 60px; max-height: 180px; overflow-y: auto; background: white; border: 1px solid #ccc; border-radius: 6px; padding: 10px; box-sizing: border-box;">
                        <!-- I checkbox dei piatti verranno iniettati qui via JS -->
                    </div>
                </div>
            </div>
            <div style="margin-bottom: 15px;">
	            <label><b>Ingredienti / Ricetta Piatto:</b></label>
	            <div id="modalPiattoIngredientiContainer" style="margin-top: 8px; max-height: 220px; overflow-y: auto; border: 1px solid #ccc; padding: 10px; border-radius: 6px; background: #fafafa;"></div>
	        </div>
	        <div class="modal-actions" style="margin-top: 25px; display: flex; justify-content: flex-end; gap: 10px;">
	            <button class="btn-chiudi" id="btnAnnullaNuovoPiatto" style="padding: 10px 20px;">Annulla</button>
	            <button class="btn-salva" id="btnSalvaNuovoPiatto" style="padding: 10px 20px;">Salva Piatto</button>
	        </div>
	    `;
	    overlay.appendChild(modal);
            document.body.appendChild(overlay);

            // POPOLIAMO LA LISTA DEI PIATTI COMBO leggendola direttamente dal database
            const containerNew = document.getElementById("modalPiattoDishesCombo");
            if (containerNew) {
                db.ref("menu").once("value").then(snap => {
                    const menuDatabase = snap.val() || {};
                    let htmlPiatti = "";
                    Object.entries(menuDatabase).forEach(([pId, p]) => {
                        // NESSUN BLOCCO! Vogliamo vedere tutti i piatti, anche le altre combo.
                        htmlPiatti += `<label style="display:flex; align-items:center; margin-bottom:8px; cursor:pointer; padding: 5px; background: #fafafa; border: 1px solid #eee; border-radius: 4px;">
                                        <input type="checkbox" class="combo-dish-cb-new" value="${pId}" style="margin-right: 10px; transform: scale(1.1);"> 
                                        <span><b>${p.nome}</b> <small style="color:#777;">(${p.categoria})</small></span>
                                     </label>`;
                    });
                    containerNew.innerHTML = htmlPiatti || "<p style='color:#777; font-size:0.9em;'>Nessun piatto disponibile.</p>";
                });
            }

            const ingContainer = document.getElementById("modalPiattoIngredientiContainer");
            const catSelect = document.getElementById("modalPiattoCat");
            window.selectedMap = {}; // Reset mappa ingredienti per il nuovo inserimento
	
	    const renderIngModal = () => {
	        renderIngredientOptionsForCategory(catSelect.value, ingContainer);
	    };
	    
	    catSelect.addEventListener("change", renderIngModal);
	    renderIngModal();
	
	    document.getElementById("btnAnnullaNuovoPiatto").onclick = () => {
	        window.selectedMap = {};
	        overlay.remove();
	    };
	
	    document.getElementById("btnSalvaNuovoPiatto").onclick = async () => {
	        const nome = document.getElementById("modalPiattoNome").value.trim();
	        const prezzo = parseFloat(document.getElementById("modalPiattoPrezzo").value);
	        const categoria = catSelect.value;
	        const maxGratisVal = document.getElementById("modalPiattoMaxGratis").value;
	        const maxVariantiGratis = maxGratisVal ? parseInt(maxGratisVal) : 0;
            
            const isCombo = document.getElementById("modalPiattoIsCombo").checked;
            const maxContorniGratis = parseInt(document.getElementById("modalPiattoMaxContorniGratis").value) || 0;
            
            // Prendiamo tutti gli ID dei piatti checkati
            const checkboxSelezionati = document.querySelectorAll(".combo-dish-cb-new:checked");
            const piattiComboAmmessi = Array.from(checkboxSelezionati).map(cb => cb.value);
	
	        if (!nome || isNaN(prezzo)) {
	            notify("Inserisci nome e prezzo validi!", "warn");
	            return;
	        }
	
	        const ingredienti = Object.keys(window.selectedMap)
	            .filter(id => id && window.ingredientData[id])
	            .map(id => ({
	                id,
	                nome: window.ingredientData[id].nome,
	                qtyPerUnit: window.selectedMap[id],
	                unita: window.ingredientData[id].unita || "pz"
	            }));
	
	        try {
	            await db.ref("menu").push({ nome, prezzo, categoria, ingredienti, maxVariantiGratis, isCombo, maxContorniGratis, piattiComboAmmessi });
	            window.selectedMap = {};
	            overlay.remove();
	            notify("Piatto aggiunto con successo al menu!", "success");
	        } catch (err) {
	            notify("Errore nell'aggiunta: " + err.message, "error");
	        }
	    };
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
    
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "10005";

    const modal = document.createElement("div");
    modal.className = "modal-varianti";
    modal.style.maxWidth = "600px";
    modal.style.width = "95%";
    modal.style.maxHeight = "90vh";
    modal.style.overflowY = "auto";
    modal.style.textAlign = "left";

    modal.innerHTML = `
        <h3 style="text-align: center; margin-bottom: 20px;">📝 Modifica Piatto: ${piatto.nome}</h3>
        <div style="margin-bottom: 12px;">
            <label><b>Nome Piatto:</b></label>
            <input type="text" id="editPiattoNome" style="width: 100%; padding: 8px; box-sizing: border-box; margin-top: 4px; border: 1px solid #ccc; border-radius: 4px;">
        </div>
        <div style="margin-bottom: 12px; display: flex; gap: 10px;">
            <div style="flex: 1;">
                <label><b>Prezzo (€):</b></label>
                <input type="number" id="editPiattoPrezzo" step="0.01" style="width: 100%; padding: 8px; box-sizing: border-box; margin-top: 4px; border: 1px solid #ccc; border-radius: 4px;">
            </div>
            <div style="flex: 1;">
                <label><b>Categoria:</b></label>
                <select id="editPiattoCat" style="width: 100%; padding: 8px; box-sizing: border-box; margin-top: 4px; height: 37px; border: 1px solid #ccc; border-radius: 4px;">
                    <option value="cibi">Cibi</option>
                    <option value="bevande">Bevande</option>
                    <option value="snack">Snack</option>
                </select>
            </div>
        </div>
        <div style="margin-bottom: 15px;">
            <label><b>Aggiunte max gratuite:</b></label>
            <input type="number" id="editPiattoMaxGratis" min="0" placeholder="0" style="width: 100%; padding: 8px; box-sizing: border-box; margin-top: 4px; border: 1px solid #ccc; border-radius: 4px;">
        </div>

       <div style="background: #f4f9f4; padding: 15px; border: 1px solid #d0e8d0; border-radius: 8px; margin-bottom: 15px; box-sizing: border-box;">
            <label style="cursor:pointer; display:flex; align-items:center; gap: 10px;">
                <input type="checkbox" id="editPiattoIsCombo" style="transform: scale(1.3);" onchange="document.getElementById('comboSettingsEdit').style.display = this.checked ? 'block' : 'none';"> 
                <b style="color: #2e7d32; font-size: 1.1em; margin: 0;">È un Piatto Combo (Menu)?</b>
            </label>
            
            <div id="comboSettingsEdit" style="display:none; margin-top:15px; padding-top: 15px; border-top: 1px dashed #c8e6c9;">
                <label style="display:block; margin-bottom: 5px;"><b>N° Contorni Gratis inclusi:</b></label>
                <input type="number" id="editPiattoMaxContorniGratis" value="0" min="0" style="width:100%; padding: 10px; margin-bottom: 15px; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box;">
                
                <label style="display:block; margin-bottom: 5px;"><b>Seleziona i piatti ammessi nel Menu:</b></label>
                <div id="editPiattoDishesCombo" style="min-height: 60px; max-height: 180px; overflow-y: auto; background: white; border: 1px solid #ccc; border-radius: 6px; padding: 10px; box-sizing: border-box;">
                    <!-- I checkbox dei piatti verranno iniettati qui via JS -->
                </div>
            </div>
        </div>
        <div style="margin-bottom: 15px;">
            <label><b>Ingredienti / Composizione:</b></label>
            <div id="editPiattoIngredientiContainer" style="margin-top: 8px; max-height: 220px; overflow-y: auto; border: 1px solid #ccc; padding: 10px; border-radius: 6px; background: #fafafa;"></div>
        </div>
        <div class="modal-actions" style="margin-top: 25px; display: flex; justify-content: flex-end; gap: 10px;">
            <button class="btn-chiudi" id="btnAnnullaEditPiatto" style="padding: 10px 20px;">Annulla</button>
            <button class="btn-salva" id="btnSalvaEditPiatto" style="padding: 10px 20px;">Salva Modifiche</button>
        </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const nomeInput = document.getElementById("editPiattoNome");
    const prezzoInput = document.getElementById("editPiattoPrezzo");
    const catSelect = document.getElementById("editPiattoCat");
    const gratisInput = document.getElementById("editPiattoMaxGratis");
    const ingrContainer = document.getElementById("editPiattoIngredientiContainer");

    // Popola con i vecchi dati attuali
    nomeInput.value = piatto.nome || "";
    prezzoInput.value = piatto.prezzo !== undefined ? piatto.prezzo : "";
    catSelect.value = piatto.categoria || "cibi";
    gratisInput.value = piatto.maxVariantiGratis !== undefined ? piatto.maxVariantiGratis : "";

    // POPOLA DATI COMBO
    if (piatto.isCombo) {
        document.getElementById("editPiattoIsCombo").checked = true;
        document.getElementById("comboSettingsEdit").style.display = "block";
        document.getElementById("editPiattoMaxContorniGratis").value = piatto.maxContorniGratis || 1;
    }
    
    // Genera la lista dei piatti nel modale di modifica
    const containerEdit = document.getElementById("editPiattoDishesCombo");
    if (containerEdit) {
        db.ref("menu").once("value").then(snap => {
            const menuDatabase = snap.val() || {};
            let htmlPiattiEdit = "";
            const piattiAmmessiGiaSalvati = piatto.piattiComboAmmessi || []; 
            
            Object.entries(menuDatabase).forEach(([pId, p]) => {
                // L'unica regola: un piatto non può contenere SE STESSO come contorno, sennò il server esplode
                if (pId !== menuId) { 
                    const isChecked = piattiAmmessiGiaSalvati.includes(pId) ? "checked" : "";
                    htmlPiattiEdit += `<label style="display:flex; align-items:center; margin-bottom:8px; cursor:pointer; padding: 5px; background: #fafafa; border: 1px solid #eee; border-radius: 4px;">
                                    <input type="checkbox" class="combo-dish-cb-edit" value="${pId}" ${isChecked} style="margin-right: 10px; transform: scale(1.1);"> 
                                    <span><b>${p.nome}</b> <small style="color:#777;">(${p.categoria})</small></span>
                                 </label>`;
                }
            });
            containerEdit.innerHTML = htmlPiattiEdit || "<p style='color:#777; font-size:0.9em;'>Nessun piatto disponibile.</p>";
        });
    }
    window.selectedMap = {};
    (piatto.ingredienti || []).forEach(i => {
        if (i.id) window.selectedMap[i.id] = i.qtyPerUnit || 1;
    });

    const renderIngEditModal = () => {
        renderIngredientOptionsForCategory(catSelect.value, ingrContainer);
    };

    catSelect.addEventListener("change", renderIngEditModal);
    renderIngEditModal();

    document.getElementById("btnAnnullaEditPiatto").onclick = () => {
        window.selectedMap = {};
        overlay.remove();
    };

    document.getElementById("btnSalvaEditPiatto").onclick = async () => {
        const newName = nomeInput.value.trim();
        const newPrezzo = parseFloat(prezzoInput.value);
        const newCat = catSelect.value;
        const newMaxGratis = parseInt(gratisInput.value) || 0;
        
        const newIsCombo = document.getElementById("editPiattoIsCombo").checked;
        const newMaxContorniGratis = parseInt(document.getElementById("editPiattoMaxContorniGratis").value) || 0;
        
        // Prendiamo le spunte
        const editCheckboxes = document.querySelectorAll(".combo-dish-cb-edit:checked");
        const newPiattiComboAmmessi = Array.from(editCheckboxes).map(cb => cb.value);

        if (!newName || isNaN(newPrezzo)) {
            notify("Nome e prezzo validi sono obbligatori.", "warn");
            return;
        }

        const ingredienti = [];
        const rows = Array.from(ingrContainer.querySelectorAll("div"));
        rows.forEach(r => {
            const chk = r.querySelector('input[type="checkbox"]');
            if (chk && chk.checked) {
                const id = chk.dataset.ingredId;
                const qtyInput = r.querySelector('input[type="number"]');
                const qty = qtyInput && qtyInput.value ? parseFloat(qtyInput.value) || 1 : 1;
                if (ingredientData[id]) {
                    ingredienti.push({
                        id,
                        nome: ingredientData[id].nome,
                        qtyPerUnit: qty,
                        unita: ingredientData[id].unita || "pz"
                    });
                }
            }
        });

        try {
            await db.ref("menu/" + menuId).update({
                nome: newName,
                prezzo: newPrezzo,
                categoria: newCat,
                ingredienti: ingredienti,
                maxVariantiGratis: newMaxGratis,
                isCombo: newIsCombo,
                maxContorniGratis: newMaxContorniGratis,
                piattiComboAmmessi: newPiattiComboAmmessi
            });
            window.selectedMap = {};
            overlay.remove();
            notify("Piatto aggiornato correttamente!", "success");
        } catch (err) {
            notify("Errore salvataggio: " + err.message, "error");
        }
    };
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

    // 🔹 LEGGI IL FONDO CASSA DAL DATABASE
    const snapFondo = await db.ref("impostazioni/fondoCassa").once("value");
    const fondoCassa = parseFloat(snapFondo.val()) || 0;

    const snap = await db.ref("comande").once("value");
    const comande = snap.val() || {};
    let totaleComande = 0;
    let totaleIncasso = 0;
    let totalePos = 0;
    let totaleContanti = 0;
    let incassoAsporto = 0;
    const piattiMap = {}; 
    const ingrMap = {}; 
    const incassiIngredienti = {}; 
    const listaComande = [];

    for (const id in comande) {
        // [IL CICLO FOR RIMANE UGUALE, NON CAMBIA NULLA]
        const c = comande[id];
        totaleComande++;
        let totaleComanda = 0;
        (c.piatti || []).forEach(p => {
            const q = Number(p.quantita || 0);
            const prezzoTot = calcolaPrezzoConSconto(p);
            totaleComanda += prezzoTot;
            
            if (!piattiMap[p.nome]) piattiMap[p.nome] = { quantita: 0, incasso: 0 };
            piattiMap[p.nome].quantita += q;
            piattiMap[p.nome].incasso += prezzoTot;
            
            (p.ingredienti || []).forEach(ing => {
                const qty = (Number(ing.qtyPerUnit) || 1) * q;
                ingrMap[ing.nome] = (ingrMap[ing.nome] || 0) + qty;
                incassiIngredienti[ing.nome] = (incassiIngredienti[ing.nome] || 0) + prezzoTot;
            });
        });
        
        if (c.metodoPagamento === "pos") {
            totalePos += totaleComanda;
        } else {
            totaleContanti += totaleComanda;
        }
        
        totaleIncasso += totaleComanda;
        if (c.commento) incassoAsporto += totaleComanda;

        listaComande.push({
            id,
            numero: c.numero,
            lettera: c.lettera,
            totale: totaleComanda,
            piatti: (c.piatti || []).map(p => p.quantita + "x " + p.nome).join(", "),
            data: c.timestamp
        });
    }

    const piattiByQuantita = Object.entries(piattiMap).sort((a,b) => b[1].quantita - a[1].quantita);
    const piattiByIncasso = Object.entries(piattiMap).sort((a,b) => b[1].incasso - a[1].incasso);
    const ingrByQuantita = Object.entries(ingrMap).sort((a,b) => b[1] - a[1]);
    const ingrIncassiArray = Object.entries(incassiIngredienti).map(([n,i]) => ({ nome: n, incasso: i }));

    window.statistiche = {
        totaleComande,
        totaleIncasso,
        totalePos,
        totaleContanti,
        incassoAsporto,
        piattiByQuantita,
        piattiByIncasso,
        ingrByQuantita,
        ingrIncassiArray,
        listaComande,
        fondoCassa // 🔹 SALVO IL FONDO CASSA IN MEMORIA PER EXCEL E PDF
    };

    const rows = piattiByQuantita.map(([nome, v]) => 
        `<tr><td style="text-align:left; padding:6px;">${nome}</td><td style="text-align:center; padding:6px;">${v.quantita}</td><td style="text-align:right; padding:6px;">€${v.incasso.toFixed(2)}</td></tr>`
    ).join("");

    contenuto.innerHTML = `
        <h3 style="color:blue;">Statistiche Vendite</h3>
        <p><b>Numero totale comande:</b> ${totaleComande}</p>
        <p><b>Fondo Cassa Iniziale:</b> €${fondoCassa.toFixed(2)}</p>
        <p><b>Incasso POS:</b> €${totalePos.toFixed(2)}</p>
        <p><b>Incasso Contanti:</b> €${totaleContanti.toFixed(2)}</p>
        <p><b>Di cui Asporto:</b> €${incassoAsporto.toFixed(2)}</p>
        <hr style="margin:15px 0; border: 1px solid #ccc;">
        <p style="font-size: 1.1em;"><b>SOLDI TOTALI IN CASSA (Fondo + Contanti):</b> <span style="color:green; font-weight:bold;">€${(fondoCassa + totaleContanti).toFixed(2)}</span></p>
        <p style="font-size: 1.1em;"><b>GUADAGNO (tolto fondo cassa):</b> <span style="color:blue; font-weight:bold;">€${totaleIncasso.toFixed(2)}</span></p>
        
        <table border="0" style="width:100%; border-collapse:collapse; margin-top:20px;">
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

 const { piattiByIncasso, piattiByQuantita, ingrByQuantita, totaleComande, totaleIncasso, totalePos, totaleContanti, incassoAsporto, fondoCassa } = s;
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
  // Totali a fianco (colonne E/F)
  sheet1.getCell('E2').value = "Numero totale comande";
  sheet1.getCell('F2').value = totaleComande;
  sheet1.getCell('E3').value = "Fondo Cassa Iniziale (€)";
  sheet1.getCell('F3').value = fondoCassa || 0;
  sheet1.getCell('E4').value = "Incasso POS (€)";
  sheet1.getCell('F4').value = totalePos;
  sheet1.getCell('E5').value = "Incasso Contanti (€)";
  sheet1.getCell('F5').value = totaleContanti;
  sheet1.getCell('E6').value = "Di cui Asporto (€)";
  sheet1.getCell('F6').value = incassoAsporto;
  sheet1.getCell('E7').value = "SOLDI TOTALI IN CASSA (€)";
  sheet1.getCell('F7').value = (fondoCassa || 0) + totaleContanti;
  sheet1.getCell('E8').value = "GUADAGNO REALE (€)";
  sheet1.getCell('F8').value = totaleIncasso;

  // Formatta tutti gli incassi come valuta
  ['F3','F4','F5','F6','F7','F8'].forEach(addr => {
      sheet1.getCell(addr).numFmt = '€#,##0.00';
  });

  // Stile blu, testo bianco e grassetto per tutto il riquadro
  ['E2','F2','E3','F3','E4','F4','E5','F5','E6','F6','E7','F7','E8','F8'].forEach(addr => {
      const cell = sheet1.getCell(addr);
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'00B0F0'} };
      cell.font = { bold:true, color:{argb:'FFFFFF'} };
  });

  // Adatta larghezza colonne dei totali
  sheet1.getColumn(5).width = 30; // colonna E allargata per i nuovi testi
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

  const { totaleComande, totaleIncasso, totalePos, totaleContanti, incassoAsporto, piattiByQuantita, piattiByIncasso, ingrByQuantita, ingrIncassiArray, listaComande, fondoCassa } = s;
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
  doc.text(`Fondo Cassa Iniziale: €${(fondoCassa || 0).toFixed(2)}`, xLeft, y);
  y += 6;
  doc.text(`Incasso POS: €${totalePos.toFixed(2)}`, xLeft, y);
  y += 6;
  doc.text(`Incasso Contanti: €${totaleContanti.toFixed(2)}`, xLeft, y);
  y += 6;
  doc.text(`Di cui Asporto: €${incassoAsporto.toFixed(2)}`, xLeft, y);
  y += 10;
  
  // Scritte in grassetto per i conti finali
  doc.setFont(undefined, 'bold');
  doc.setTextColor(0, 100, 0); // Verde scuro
  doc.text(`SOLDI TOTALI IN CASSA (Fondo + Contanti): €${((fondoCassa || 0) + totaleContanti).toFixed(2)}`, xLeft, y);
  y += 8;
  doc.setTextColor(0, 0, 255); // Blu
  doc.text(`GUADAGNO REALE (tolto fondo cassa): €${totaleIncasso.toFixed(2)}`, xLeft, y);
  y += 12;
  
  // Resetta colore e font per le tabelle sottostanti
  doc.setTextColor(0, 0, 0);
  doc.setFont(undefined, 'normal');
	
	
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
    if (!checkOnline(true)) return;

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "10005";

    const modal = document.createElement("div");
    modal.className = "modal-varianti";
    modal.style.maxWidth = "450px";
    modal.style.width = "90%";
    modal.style.textAlign = "left";

    modal.innerHTML = `
        <h3 style="text-align: center; margin-bottom: 20px;">🏷️ Gestione Sconto: ${piatto.nome}</h3>
        <div style="margin-bottom: 15px;">
            <label><b>Tipo Strategia Sconto:</b></label>
            <select id="modalScontoTipo" style="width: 100%; padding: 8px; box-sizing: border-box; margin-top: 4px; height: 37px; border: 1px solid #ccc; border-radius: 4px;">
                <option value="percentuale">Sconto Percentuale (%)</option>
                <option value="x_paga_y">Prendi X Paga Y articoli</option>
                <option value="x_paga_y_fisso">Prendi X Paga Prezzo Fisso (€)</option>
            </select>
        </div>
        
        <div id="containerScontoPercentuale" style="margin-bottom: 15px;">
            <label><b>Percentuale Sconto (%):</b></label>
            <input type="number" id="modalScontoPerc" min="0" max="100" step="0.1" style="width: 100%; padding: 8px; box-sizing: border-box; margin-top: 4px; border: 1px solid #ccc; border-radius: 4px;">
        </div>

        <div id="containerScontoQuantita" style="margin-bottom: 15px; display: none; gap: 10px;">
            <div style="flex: 1;">
                <label><b>Articoli Richiesti (X):</b></label>
                <input type="number" id="modalScontoX" min="1" step="1" style="width: 100%; padding: 8px; box-sizing: border-box; margin-top: 4px; border: 1px solid #ccc; border-radius: 4px;">
            </div>
            <div style="flex: 1;">
                <label id="labelScontoY"><b>Paga (Y):</b></label>
                <input type="number" id="modalScontoY" min="0.01" step="any" style="width: 100%; padding: 8px; box-sizing: border-box; margin-top: 4px; border: 1px solid #ccc; border-radius: 4px;">
            </div>
        </div>

        <div class="modal-actions" style="margin-top: 25px; display: flex; justify-content: flex-end; gap: 10px;">
            <button class="btn-chiudi" id="btnAnnullaSconto" style="padding: 10px 20px;">Annulla</button>
            <button class="btn-salva" id="btnSalvaSconto" style="padding: 10px 20px;">Salva Sconto</button>
        </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const tipoSelect = document.getElementById("modalScontoTipo");
    const percContainer = document.getElementById("containerScontoPercentuale");
    const qtyContainer = document.getElementById("containerScontoQuantita");
    const labelY = document.getElementById("labelScontoY");

    const percInput = document.getElementById("modalScontoPerc");
    const xInput = document.getElementById("modalScontoX");
    const yInput = document.getElementById("modalScontoY");

    // Pre-popola se c'era uno sconto precedente attivo
    tipoSelect.value = piatto.sconto?.tipo || "percentuale";
    if (piatto.sconto?.tipo === "percentuale") {
        percInput.value = piatto.sconto.valore || 0;
    } else if (piatto.sconto?.tipo === "x_paga_y" || piatto.sconto?.tipo === "x_paga_y_fisso") {
        xInput.value = piatto.sconto.valore?.x || 1;
        yInput.value = piatto.sconto.valore?.y || 1;
    }

    function aggiornaCampiScontoVisibili() {
        if (tipoSelect.value === "percentuale") {
            percContainer.style.display = "block";
            qtyContainer.style.display = "none";
        } else {
            percContainer.style.display = "none";
            qtyContainer.style.display = "flex";
            if (tipoSelect.value === "x_paga_y") {
                labelY.innerHTML = "<b>Articoli da Pagare (Y):</b>";
                yInput.step = "1";
            } else {
                labelY.innerHTML = "<b>Prezzo Totale Fisso (Y €):</b>";
                yInput.step = "0.01";
            }
        }
    }

    tipoSelect.addEventListener("change", aggiornaCampiScontoVisibili);
    aggiornaCampiScontoVisibili();

    document.getElementById("btnAnnullaSconto").onclick = () => overlay.remove();

    document.getElementById("btnSalvaSconto").onclick = () => {
        let scontoObj;
        if (tipoSelect.value === "percentuale") {
            const v = parseFloat(percInput.value);
            if (isNaN(v) || v < 0 || v > 100) return notify("Inserisci una percentuale valida (0-100).", "warn");
            scontoObj = { tipo: "percentuale", valore: v };
        } 
        else if (tipoSelect.value === "x_paga_y") {
            const x = parseInt(xInput.value, 10);
            const y = parseInt(yInput.value, 10);
            if (isNaN(x) || isNaN(y) || x < 1 || y < 1) return notify("Inserisci numeri interi validi.", "warn");
            if (y > x) return notify("Gli articoli pagati (Y) non possono superare quelli presi (X).", "error");
            scontoObj = { tipo: "x_paga_y", valore: { x, y } };
        } 
        else if (tipoSelect.value === "x_paga_y_fisso") {
            const x = parseInt(xInput.value, 10);
            const y = parseFloat(yInput.value);
            if (isNaN(x) || isNaN(y) || x < 1 || y <= 0) return notify("Inserisci quantità e prezzi validi.", "warn");
            scontoObj = { tipo: "x_paga_y_fisso", valore: { x, y } };
        }

        db.ref("menu/" + id + "/sconto").set(scontoObj).then(() => {
            caricaScontiAdmin();
            overlay.remove();
            notify("Regola di sconto applicata correttamente!", "success");
        }).catch(err => { 
            notify("Errore nel salvataggio: " + err.message, "error"); 
        });
    };
}

//invio comanda di ogni tipo in fondo per evitari errori
document.addEventListener("DOMContentLoaded", () => {
    const inviaBtn = document.getElementById("inviaComandaBtn");
    if (!inviaBtn) return; // sicurezza
    
    const numInput = document.getElementById("numComanda");
    const letteraInput = document.getElementById("letteraComanda");
    const noteInput = document.getElementById("noteComanda");

    inviaBtn.addEventListener("click", async () => {
        const num = numInput ? numInput.value.trim() : "";
        let lettera = letteraInput ? letteraInput.value.trim().toUpperCase() : "";

        // 1. Controllo Lettera (Obbligatoria SOLO se abilitata dalle impostazioni)
        if (window.settings.letteraComandaAbilitata) {
            if (!lettera || !/^[A-Z]$/.test(lettera)) {
                notify("Inserisci una lettera valida!", "error");
                return;
            }
        } else {
            lettera = ""; // Svuotiamo forzatamente la lettera se il sistema l'ha disattivata
        }

        // 2. Controllo Numero (Obbligatorio SOLO se il sistema progressivo è disattivato)
        if (!window.settings.comandeProgressive && !num) {
            notify("Inserisci un numero comanda valido!", "error");
            return;
        }

        const piattiValidi = comandaCorrente.filter(p => p.quantita > 0);

        if (!piattiValidi.length) {
            notify("Inserisci almeno un piatto con quantità maggiore di 0!", "error");
            return;
        }

        // 3. Controllo note e destinazioni (MANTENUTO DAL TUO CODICE ORIGINALE)
        const note = noteInput ? noteInput.value.trim() : "";
        
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

            let numeroComandaFinale = "";

            // --- 4. ASSEGNAZIONE NUMERO E CONTROLLO DUPLICATI SUPER SICURO ---
            if (window.settings.comandeProgressive) {
                // SISTEMA PROGRESSIVO AUTOMATICO
                let duplicato = true;
                let tentativi = 0;
                
                // Cerca un numero libero saltando automaticamente quelli già esistenti (max 15 tentativi per sicurezza)
                while (duplicato && tentativi < 15) { 
                    const counterRef = db.ref("impostazioni/contatoreComande");
                    const res = await counterRef.transaction(corrente => {
                        return (corrente || 0) + 1;
                    });

                    if (res.committed) {
                        numeroComandaFinale = String(res.snapshot.val()) + lettera;
                        
                        // Controlla se questo numero esiste già nel database
                        const existing = await db.ref("comande").orderByChild("numero").equalTo(numeroComandaFinale).once("value");
                        if (!existing.exists()) {
                            duplicato = false; // Trovato un numero libero! Esce dal ciclo.
                        }
                        // Se esiste, il ciclo ricomincia da capo incrementando ulteriormente il contatore Firebase da solo
                    } else {
                        throw new Error("Transazione contatore fallita.");
                    }
                    tentativi++;
                }

                if (duplicato) {
                    notify("❌ Impossibile trovare un numero libero. Cancella le vecchie comande per fare spazio.", "error");
                    inviaBtn.disabled = false;
                    inviaBtn.innerText = "Invia Comanda";
                    return;
                }
                
            } else {
                // SISTEMA MANUALE TRADIZIONALE
                numeroComandaFinale = String(num) + lettera;
                const existing = await db.ref("comande").orderByChild("numero").equalTo(numeroComandaFinale).once("value");
                
                if (existing.exists()) {
                    notify("❌ Comanda " + numeroComandaFinale + " già presente! Non è possibile inviarne un'altra identica.", "error");
                    inviaBtn.disabled = false;
                    inviaBtn.innerText = "Invia Comanda";
                    return;
                }
            }

            // 5. Controllo disponibilità ingredienti e scalo (MANTENUTO)
            const richieste = calcolaRichiesteDaPiatti(piattiValidi);
            const resIng = await applicaDecrementiIngredienti(richieste);

            if (!resIng.success) {
                notify("Impossibile inviare comanda: " + (resIng.message || "errore ingredienti"), "error");
                // Tolto return, il finally sblocca
                throw new Error(resIng.message || "errore ingredienti"); 
            }

            // --- 6. COSTRUZIONE OGGETTO COMANDA (MANTENUTO) ---
            const orario = new Date().toLocaleTimeString("it-IT", { hour12: false });
            const ref = db.ref("comande").push();
            
            // Check asporto
            const checkAsporto = document.getElementById("checkAsporto");
            let commentoAsporto = "";
            if (window.settings.asportoAbilitato && checkAsporto && checkAsporto.checked) {
                commentoAsporto = "ASPORTO";
            }
            
            const metodoPagamentoEl = document.getElementById("metodoPagamento");
            const metodoPagamento = metodoPagamentoEl ? metodoPagamentoEl.value : "contanti";

            let noteDestinazioni = [];

            if (window.settings.noteDestinazioniAbilitate) {
                if (document.getElementById("tickCucina") && document.getElementById("tickCucina").checked) noteDestinazioni.push("cucina");
                if (document.getElementById("tickBere") && document.getElementById("tickBere").checked) noteDestinazioni.push("bere");
                if (document.getElementById("tickSnack") && document.getElementById("tickSnack").checked) noteDestinazioni.push("snack");
            } else {
                // default legacy
                noteDestinazioni = ["cucina"];
                if (window.settings.snackAbilitato) noteDestinazioni.push("snack");
            }

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

            if (window.settings.snackAbilitato) {
                nuovaComanda.statoSnack = "da fare";
            }

            // Salvataggio nel DB
            await ref.set(nuovaComanda);

            // --- 7. STAMPA E RESET FRONTEND (MANTENUTO) ---
            const piattiDaStampare = [...comandaCorrente];
            const noteDaStampare = note;
            const numeroComandaDaStampare = numeroComandaFinale;
            
            comandaCorrente = [];
            if(typeof aggiornaComandaCorrente === 'function') aggiornaComandaCorrente();
            if(typeof sincronizzaDisplayLive === 'function') sincronizzaDisplayLive();
            
            if (noteInput) noteInput.value = ""; 
            if (!window.settings.comandeProgressive && numInput) {
                numInput.value = ""; 
            }
            if (letteraInput) letteraInput.value = "";
            
            totalePagato = 0;
            const totalePagatoSpan = document.getElementById("totalePagato");
            const restoDovutoSpan = document.getElementById("restoDovuto");
            if (totalePagatoSpan) totalePagatoSpan.innerText = "0.00";
            if (restoDovutoSpan) restoDovutoSpan.innerText = "0.00";
            
            if(typeof aggiornaSuggerimentoResto === 'function') aggiornaSuggerimentoResto();
            if (checkAsporto) checkAsporto.checked = false;

            if (!window.settings.stampaAutomaticaComande) {
			    notify("✅ Comanda " + numeroComandaFinale + " inviata con successo!", "info");
			} else {
			    notify("✅ Comanda " + numeroComandaFinale + " inviata, avvio stampa...", "info");
			    if (typeof stampaComanda === 'function') {
			        stampaComanda(piattiDaStampare, numeroComandaFinale, noteDaStampare);
			    }
			}
        } catch (err) {
            console.error("Errore invio comanda:", err);
            notify("Errore invio comanda: " + (err.message || err), "error");
        } finally {
            inviaBtn.disabled = false;
            inviaBtn.innerText = "Invia Comanda";
            if(typeof aggiornaStatoInvio === 'function') aggiornaStatoInvio();
        }
    });
});
// --- INIZIO FUNZIONE DISPLAY LIVE ---
let ultimoDatoLive = "";

function sincronizzaDisplayLive() {
    // Esci se non abilitato o se non sei in un profilo che può inviare (Cassa/Admin)
    if (!window.settings || !window.settings.displayClienteAbilitato || (ruolo !== 'cassa' && ruolo !== 'admin')) return;
    if (!uid) return;

    // Cattura i valori in modo sicuro
    const totale = parseFloat(document.getElementById("totale").innerText) || 0;
    const elemNum = document.getElementById("numComanda");
    const elemLett = document.getElementById("letteraComanda");
    const num = elemNum ? elemNum.value.trim() : "";
    const lett = elemLett ? elemLett.value.trim().toUpperCase() : "";

    const dati = {
        piatti: (typeof comandaCorrente !== 'undefined' ? comandaCorrente : []).map(p => ({
            nome: p.nome,
            quantita: p.quantita,
            prezzo: p.sconto ? (calcolaPrezzoConSconto(p) / p.quantita) : p.prezzo // prezzo unitario calcolato
        })),
        totale: totale,
        numeroComanda: (num + lett) || "---",
        pagato: (typeof totalePagato !== 'undefined' ? totalePagato : 0),
        resto: parseFloat(document.getElementById("restoDovuto")?.innerText) || 0,
        timestamp: Date.now()
    };

    // CREAZIONE DEL PROIETTORE:
    // Creiamo una stringa dati senza timestamp per confrontarla
    const perConfronto = { ...dati, timestamp: 0 };
    const stringaDati = JSON.stringify(perConfronto);

    // Invia al database SOLO se i dati sono cambiati rispetto a 300ms fa
    if (stringaDati !== ultimoDatoLive) {
        db.ref("displayLive/" + uid).set(dati)
          .then(() => { ultimoDatoLive = stringaDati; })
          .catch(err => console.warn("Errore Sincronizzazione Display:", err));
    }
}

// Avvia l'aggiornamento live 3 volte al secondo!
setInterval(sincronizzaDisplayLive, 300);
// --- FINE FUNZIONE DISPLAY LIVE ---
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
async function stampaComanda(items, numeroComanda, note = "", cliente = {}) {
    if (!items || items.length === 0) return;

    const { jsPDF } = window.jspdf;
    // Formato scontrino termico 80mm
    const doc = new jsPDF({ unit: "mm", format: [80, 250], orientation: "portrait" });

    const ora = new Date();
    const orario = ora.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const dataOdierna = ora.toLocaleDateString();

    // --- 1. DIVISIONE IN REPARTI ---
    let reparti = [];
    if (window.settings.scontriniSeparati) {
        // Usiamo il nuovo smistatore intelligente
        const separati = separaComanda(items);
        if (separati.cibo.length > 0) reparti.push({ nome: "CUCINA", items: separati.cibo });
        if (separati.bere.length > 0) reparti.push({ nome: "BERE", items: separati.bere });
        if (separati.snack.length > 0) reparti.push({ nome: "SNACK", items: separati.snack });
    } else {
        // Scontrino Unico
        reparti.push({ nome: null, items: items });
    }

    // --- 2. DISEGNO DEL PDF PER OGNI REPARTO ---
    reparti.forEach((reparto, index) => {
        if (index > 0) doc.addPage();

        let y = 8;
        const margin = 4;
        const pageWidth = 80;
        const rightMargin = pageWidth - margin;

        // INTESTAZIONE...
        doc.setFontSize(16); doc.setFont("helvetica", "bold");
        const nomeStand = (cliente && cliente.nomeStand) ? cliente.nomeStand : (window.settings && window.settings.nomeStand ? window.settings.nomeStand : "BistroBò");
        doc.text(nomeStand.toUpperCase(), pageWidth / 2, y, { align: "center" }); y += 6;
        doc.setFontSize(10); doc.setFont("helvetica", "normal");
        doc.text(`${dataOdierna} - Ore ${orario}`, pageWidth / 2, y, { align: "center" }); y += 6;
        doc.text("-".repeat(45), pageWidth / 2, y, { align: "center" }); y += 8;

        doc.setFontSize(24); doc.setFont("helvetica", "bold");
        doc.text(`COMANDA ${numeroComanda}`, pageWidth / 2, y, { align: "center" }); y += 7;

        if (reparto.nome) {
            doc.setFontSize(14); doc.text(`*** ${reparto.nome} ***`, pageWidth / 2, y, { align: "center" }); y += 6;
        }

        doc.setFontSize(10); doc.setFont("helvetica", "normal");
        doc.text("-".repeat(45), pageWidth / 2, y, { align: "center" }); y += 6;

        if (cliente && cliente.nome) {
            doc.setFontSize(11); doc.setFont("helvetica", "bold");
            doc.text(`Cliente: ${cliente.nome}`, margin, y); y += 5;
            if (cliente.telefono) { doc.setFont("helvetica", "normal"); doc.text(`Tel: ${cliente.telefono}`, margin, y); y += 5; }
            if (cliente.posizione) { doc.text(`Pos: ${cliente.posizione}`, margin, y); y += 5; }
            doc.text("-".repeat(45), pageWidth / 2, y, { align: "center" }); y += 6;
        }

        doc.setFontSize(10); doc.setFont("helvetica", "bold");
        doc.text("Q.TA  DESCRIZIONE", margin, y); doc.text("IMPORTO", rightMargin, y, { align: "right" }); y += 2;
        doc.setFont("helvetica", "normal"); doc.text("-".repeat(45), pageWidth / 2, y, { align: "center" }); y += 5;

        let totaleReparto = 0;

        reparto.items.forEach(p => {
            // SE IL PIATTO PRINCIPALE APPARTIENE A QUESTO REPARTO
            if (p.isMainHere !== false) {
                let prezzoTotPiatto = 0;
                if (typeof calcolaPrezzoConSconto === "function") {
                    prezzoTotPiatto = calcolaPrezzoConSconto(p, items);
                } else {
                    prezzoTotPiatto = (p.prezzo + (p.extraPrezzo || 0)) * (p.quantita || 1);
                }
                totaleReparto += prezzoTotPiatto;

                doc.setFontSize(12); doc.setFont("helvetica", "bold");
                doc.text(`${p.quantita}x`, margin, y);
                const nomeSplit = doc.splitTextToSize(p.nome, 48);
                doc.text(nomeSplit, margin + 8, y);
                doc.text(`€ ${prezzoTotPiatto.toFixed(2)}`, rightMargin, y, { align: "right" });
                y += (nomeSplit.length * 5); 

                // Varianti Main
                let variantiArray = p.varianti ? (Array.isArray(p.varianti) ? p.varianti : Object.values(p.varianti)) : [];
                if (variantiArray.length > 0) {
                    doc.setFontSize(10); doc.setFont("helvetica", "normal");
                    let maxGratis = p.maxVariantiGratis || 0;
                    let aggiunteCount = 0;

                    variantiArray.filter(v => v.tipo === "rimozione").forEach(v => {
                        doc.text(`   - NO ${v.nome}`, margin + 8, y); y += 4.5;
                    });

                    const aggiunte = variantiArray.filter(v => v.tipo === "aggiunta");
                    const mappaAggiunte = {};
                    aggiunte.forEach(v => {
                        let prezzoAggiunta = 0;
                        if (aggiunteCount >= maxGratis) { prezzoAggiunta = Number(v.prezzo || 0); }
                        aggiunteCount++;
                        if (!mappaAggiunte[v.nome]) mappaAggiunte[v.nome] = { nome: v.nome, count: 0, costoTot: 0 };
                        mappaAggiunte[v.nome].count++; mappaAggiunte[v.nome].costoTot += prezzoAggiunta;
                    });

                    Object.values(mappaAggiunte).forEach(a => {
                        const aqTxt = a.count > 1 ? `${a.count}x ` : "";
                        doc.text(`   + ${aqTxt}${a.nome}`, margin + 8, y);
                        const stringaCosto = a.costoTot > 0 ? `€ ${a.costoTot.toFixed(2)}` : `€ 0.00`;
                        doc.text(stringaCosto, rightMargin, y, { align: "right" }); y += 4.5;
                    });
                }
            } else {
                // IL PIATTO PRINCIPALE NON E' QUI (Solo Contesto, es. per le Patatine in Snack)
                doc.setFontSize(10); doc.setFont("helvetica", "italic");
                doc.text(`[Di: ${p.quantita}x ${p.nome}]`, margin, y);
                y += 5;
            }
            
            // --- STAMPA CONTORNI COMBO ---
            if (p.contorniScelti && p.contorniScelti.length > 0) {
                doc.setFontSize(10); doc.setFont("helvetica", "italic");
                p.contorniScelti.forEach(c => {
                    doc.text(`   => ${p.quantita}x ${c.nome}`, margin + 8, y);
                    
                    // Il costo del contorno è già calcolato nel totale di calcolaPrezzoConSconto(p)
                    let txtCosto = "";
                    if (p.isMainHere !== false) {
                        txtCosto = c.isGratis ? "INCLUSO" : `€ ${(c.prezzoPagato || 0).toFixed(2)}`;
                    } 
                    doc.text(txtCosto, rightMargin, y, { align: "right" });
                    y += 4.5;
                    
                    // Varianti Contorno
                    if (c.varianti && c.varianti.length > 0) {
                        c.varianti.forEach(v => {
                            const pre = v.tipo === 'aggiunta' ? '+' : '-';
                            doc.text(`       ${pre} ${v.nome}`, margin + 8, y); y += 4.5;
                        });
                    }
                });
            }
            y += 2; 
        });

        // TOTALE E NOTE...
        doc.setFontSize(10); doc.setFont("helvetica", "normal"); y += 2;
        doc.text("-".repeat(45), pageWidth / 2, y, { align: "center" }); y += 8;
        doc.setFontSize(18); doc.setFont("helvetica", "bold");
        doc.text("TOTALE", margin, y); doc.text(`€ ${totaleReparto.toFixed(2)}`, rightMargin, y, { align: "right" }); y += 8;

        doc.setFontSize(11); doc.setFont("helvetica", "normal");
        if (cliente && cliente.restoRichiesto && cliente.restoRichiesto > 0) { doc.text(`Da dare resto su: € ${cliente.restoRichiesto}`, margin, y); y += 6; }
        if (note) {
            y += 2; doc.setFontSize(10); doc.setFont("helvetica", "bold");
            const noteSplit = doc.splitTextToSize(`NOTE: ${note}`, pageWidth - margin*2);
            doc.text(noteSplit, margin, y); y += (noteSplit.length * 5);
        }
        y += 5; doc.setFontSize(10); doc.setFont("helvetica", "italic");
        doc.text("Grazie e Buon Appetito!", pageWidth / 2, y, { align: "center" });
    });

    // --- 3. CREAZIONE FINESTRA SINGOLA ---
    const pdfBase64 = doc.output("datauristring");
    const newWindow = window.open("", "_blank");
    
    // Controllo anti-crash se il browser blocca i popup
    if (newWindow) {
        newWindow.document.write(`
            <html><head><title>Scontrino ${numeroComanda}</title></head>
            <body style="margin:0; background:#555; display:flex; justify-content:center;">
                <iframe src="${pdfBase64}" style="border:none; width:80mm; height:100vh; background:white;"></iframe>
                <script>
                    window.onload = () => {
                        const iframe = document.querySelector('iframe');
                        iframe.onload = () => setTimeout(() => iframe.contentWindow.print(), 300);
                    };
                </script>
            </body></html>
        `);
        newWindow.document.close();
    } else {
        notify("Errore: il browser ha bloccato il popup per la stampa. Controlla le impostazioni in alto a destra.", "error");
    }
}
window.apriPopupVariantiContorno = function(idxPiatto, idxContorno) {
    const piattoPadre = comandaCorrente[idxPiatto];
    const contorno = piattoPadre.contorniScelti[idxContorno];

    const piattoOriginale = window.menuData ? window.menuData[contorno.id] : null;
    if (!piattoOriginale) return;

    if (!contorno.varianti) contorno.varianti = [];
    if (!contorno.extraPrezzo) contorno.extraPrezzo = 0;

    let tempVarianti = JSON.parse(JSON.stringify(contorno.varianti));
    let tempExtraPrezzo = contorno.extraPrezzo;

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const modal = document.createElement("div");
    modal.className = "modal-varianti";
    
    let maxGratis = piattoOriginale.maxVariantiGratis || 0;
    const testoGratis = maxGratis > 0 ? `<br><small style="color:green; font-size:0.75em;">(Promozione: Hai ${maxGratis} aggiunte GRATIS!)</small>` : "";
    const titolo = document.createElement("h3");
    titolo.innerHTML = `Modifica: ${contorno.nome} ${testoGratis}`;
    modal.appendChild(titolo);

    const listaDiv = document.createElement("div");

    function renderListaIngredientiContorno() {
        let totaleExtra = 0;
        tempVarianti.filter(v => v.tipo === "aggiunta").forEach((v, index) => {
            if (index >= maxGratis) totaleExtra += Number(v.prezzo || 0);
        });
        tempExtraPrezzo = totaleExtra;
        
        const aggiunteFatte = tempVarianti.filter(v => v.tipo === "aggiunta").length;
        const isProssimaGratis = aggiunteFatte < maxGratis;
        listaDiv.innerHTML = "";

        

        // FIX: Recuperiamo sia ID che Nomi per retrocompatibilità
        const baseIds = (piattoOriginale.ingredienti || []).map(i => i.id).filter(id => id);
        const baseNomi = (piattoOriginale.ingredienti || []).map(i => (i.nome || "").trim().toLowerCase());

        Object.entries(window.ingredientData || {}).forEach(([id, ing]) => {
            const catsApp = ing.categorieApplicabili || [ing.categoria || "cibi"];
            
            // FIX: Conversione vecchia categoria
            let catPiatto = (piattoOriginale.categoria || "cibi").toLowerCase();
            if (catPiatto === "cucina") catPiatto = "cibi";

            // Riconoscimento ingrediente base migliorato
            const isBase = baseIds.includes(id) || baseNomi.includes((ing.nome || "").trim().toLowerCase());
            const isExtraFlag = (ing.usabileComeExtra === true) && catsApp.includes(catPiatto);
	        
	
	        let allowRemove = false;
	        let allowAdd = false;
	
	        if (window.settings.sistemaExtraAbilitato) {
	            if (isBase) allowRemove = true;
	            if (isExtraFlag) allowAdd = true;
	        } else {
	            // Se EXTRA OFF: mostra solo se è nella ricetta base E ANCHE abilitato come extra (solo per toglierlo)
	            if (isBase && isExtraFlag) allowRemove = true;
	        }
	
	        if (!allowRemove && !allowAdd) return;

            const row = document.createElement("div");
            row.className = "variante-row";
            const nomeSpan = document.createElement("span");
            nomeSpan.innerText = ing.nome;
            const btnContainer = document.createElement("div");

            if (allowRemove) {
                const btnRemove = document.createElement("button");
                const isRimosso = tempVarianti.some(v => v.tipo === "rimozione" && v.id === id);
                if (isRimosso) {
                    btnRemove.className = "variante-btn disabled";
                    btnRemove.innerText = "Annulla Rimozione";
                    btnRemove.onclick = () => {
                        tempVarianti = tempVarianti.filter(v => !(v.tipo === "rimozione" && v.id === id));
                        renderListaIngredientiContorno();
                    };
                } else {
                    btnRemove.className = "variante-btn remove";
                    btnRemove.innerText = "- Rimuovi";
                    btnRemove.onclick = () => {
                        tempVarianti.push({ tipo: "rimozione", id: id, nome: ing.nome });
                        renderListaIngredientiContorno();
                    };
                }
                btnContainer.appendChild(btnRemove);
            }

            if (allowAdd) {
                const costoExtra = ing.prezzoExtra !== undefined ? Number(ing.prezzoExtra) : 0.50;
                const qtyExtra = ing.qtyExtra !== undefined ? Number(ing.qtyExtra) : 1;
                const occorrenze = tempVarianti.filter(v => v.tipo === "aggiunta" && v.id === id).length;

                const wrapperAdd = document.createElement("div");
                wrapperAdd.style.display = "inline-flex"; wrapperAdd.style.alignItems = "center"; wrapperAdd.style.marginLeft = "5px";

                if (occorrenze > 0) {
                    const btnMinus = document.createElement("button"); btnMinus.className = "variante-btn remove"; btnMinus.innerText = "-"; btnMinus.style.padding = "4px 10px";
                    btnMinus.onclick = () => {
                        const reversedIndex = [...tempVarianti].reverse().findIndex(v => v.tipo === "aggiunta" && v.id === id);
                        if (reversedIndex !== -1) tempVarianti.splice(tempVarianti.length - 1 - reversedIndex, 1);
                        renderListaIngredientiContorno();
                    };
                    const spanCount = document.createElement("span"); spanCount.innerText = occorrenze; spanCount.style.margin = "0 8px"; spanCount.style.fontWeight = "bold";
                    const btnPlus = document.createElement("button"); btnPlus.className = "variante-btn add"; btnPlus.innerText = "+"; btnPlus.style.padding = "4px 10px";
                    btnPlus.onclick = () => { tempVarianti.push({ tipo: "aggiunta", id: id, nome: ing.nome, qty: qtyExtra, prezzo: costoExtra }); renderListaIngredientiContorno(); };

                    wrapperAdd.appendChild(btnMinus); wrapperAdd.appendChild(spanCount); wrapperAdd.appendChild(btnPlus);
                } else {
                    const btnAdd = document.createElement("button"); btnAdd.className = "variante-btn add";
                    btnAdd.innerText = isProssimaGratis ? `+ Aggiungi (GRATIS)` : `+ Aggiungi (€${costoExtra.toFixed(2)})`;
                    btnAdd.onclick = () => { tempVarianti.push({ tipo: "aggiunta", id: id, nome: ing.nome, qty: qtyExtra, prezzo: costoExtra }); renderListaIngredientiContorno(); };
                    wrapperAdd.appendChild(btnAdd);
                }
                btnContainer.appendChild(wrapperAdd);
            }
            row.appendChild(nomeSpan); row.appendChild(btnContainer); listaDiv.appendChild(row);
        });
    }

    renderListaIngredientiContorno();
    modal.appendChild(listaDiv);

    const actionDiv = document.createElement("div"); actionDiv.className = "modal-actions";
    const btnAnnulla = document.createElement("button"); btnAnnulla.className = "btn-chiudi"; btnAnnulla.innerText = "Annulla"; btnAnnulla.onclick = () => overlay.remove();
    const btnSalva = document.createElement("button"); btnSalva.className = "btn-salva"; btnSalva.innerText = "Salva";
    btnSalva.onclick = () => {
        contorno.varianti = tempVarianti; contorno.extraPrezzo = tempExtraPrezzo;
        let nuovoExtraPrezzoPiatto = 0;
        piattoPadre.contorniScelti.forEach(c => { nuovoExtraPrezzoPiatto += (c.prezzoPagato || 0); nuovoExtraPrezzoPiatto += (c.extraPrezzo || 0); });
        let extraVariantiPiatto = 0; const maxGratisPiatto = piattoPadre.maxVariantiGratis || 0;
        (piattoPadre.varianti || []).filter(v => v.tipo === "aggiunta").forEach((v, index) => { if (index >= maxGratisPiatto) extraVariantiPiatto += Number(v.prezzo || 0); });
        piattoPadre.extraPrezzo = extraVariantiPiatto + nuovoExtraPrezzoPiatto;
        aggiornaComandaCorrente();
        overlay.remove();
    };
    actionDiv.appendChild(btnAnnulla); actionDiv.appendChild(btnSalva); modal.appendChild(actionDiv); overlay.appendChild(modal); document.body.appendChild(overlay);
};
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
