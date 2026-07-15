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
    piattiComboAbilitati: false,
	preordiniAsportoAutomatico: false,
	annullamentoVendita: false,
	tempoAnnullamento: 30,
    giocoScontrino: false,
	qrCodeStatoOrdine: false,
	scorciatoieTastiera: false
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
// Aggiungi questo sotto le impostazioni globali
window.categoriaHaPiatti = function(catCercata) {
    if (!window.menuData) return false;
    const search = catCercata.toLowerCase();
    const lE1 = (window.nomiRepartiExtra?.extra1 || "").toLowerCase().trim();
    const lE2 = (window.nomiRepartiExtra?.extra2 || "").toLowerCase().trim();
    const lE3 = (window.nomiRepartiExtra?.extra3 || "").toLowerCase().trim();

    for (let key in window.menuData) {
        let ctg = (window.menuData[key].categoria || "cibi").toLowerCase().trim();
        // Normalizza il nome
        if (ctg === "extra1" || ctg === "risto" || (lE1 && ctg === lE1)) ctg = "extra1";
        else if (ctg === "extra2" || (lE2 && ctg === lE2)) ctg = "extra2";
        else if (ctg === "extra3" || (lE3 && ctg === lE3)) ctg = "extra3";

        if (ctg === search) return true;
    }
    return false;
};
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


// ================= GESTIONE CHIUSURA FINE SERVIZIO =================
window.repartiChiusi = {};
window.permessiChiusura = {};

const toggleChiusuraBtn = document.getElementById("toggleChiusuraRepartiBtn");
const btnGestisciChiusure = document.getElementById("btnGestisciChiusure");
const chiusuraRef = db.ref("impostazioni/chiusuraServizio");

if (toggleChiusuraBtn) {
    // 1. Inizializza il Toggle Master
    initToggle(toggleChiusuraBtn, chiusuraRef.child("abilitato"), {on: "ON", off: "OFF"}, false, val => {
        if (btnGestisciChiusure) btnGestisciChiusure.style.display = val ? "inline-block" : "none";
    });

    // 2. Ascolto Globale
    chiusuraRef.on("value", snap => {
        const data = snap.val() || {};
        window.repartiChiusi = data.chiusi || {};
        window.permessiChiusura = data.permessi || {};
        const sistemaAttivo = data.abilitato === true;

        if (btnGestisciChiusure) btnGestisciChiusure.style.display = sistemaAttivo ? "inline-block" : "none";

        ["cucina", "bere", "snack", "extra1", "extra2", "extra3"].forEach(rep => {
            const isChiuso = window.repartiChiusi[rep] === true;

            // --- A) LATO OPERATORE (Es: Cuoco) ---
            const btnOp = document.getElementById(`btnChiudiServizio_${rep}`);
            if (btnOp) {
                // Il tasto Chiudi appare SOLO se ha il permesso E non ha ancora chiuso
                if (sistemaAttivo && window.permessiChiusura[rep] && !isChiuso) {
                    btnOp.style.display = "inline-block";
                    btnOp.onclick = () => confermaChiusuraOperatore(rep);
                } else {
                    btnOp.style.display = "none"; // Sparisce appena chiude!
                }
            }

            // --- B) LATO ADMIN (Gestione Profili) ---
            const statoSpan = document.getElementById(`statoChiusuraAdmin_${rep}`);
            const btnAdminChiudi = document.getElementById(`btnAdminChiusura_${rep}`);
            
            if (statoSpan && btnAdminChiudi) {
                if (sistemaAttivo) {
                    statoSpan.innerHTML = isChiuso 
                        ? `<span style="color:#d32f2f;">🛑 Chiuso</span>` 
                        : `<span style="color:#4CAF50;">🟢 Aperto</span>`;
                    
                    // Il tasto ora è sempre visibile e funziona da toggle
                    btnAdminChiudi.style.display = "inline-block";
                    
                    if (isChiuso) {
                        btnAdminChiudi.innerText = "🟢 RIAPRI";
                        btnAdminChiudi.style.background = "#4CAF50"; // Verde
                        btnAdminChiudi.onclick = () => {
                            db.ref(`impostazioni/chiusuraServizio/chiusi/${rep}`).set(false);
                            notify(`Reparto riaperto!`, "success");
                        };
                    } else {
                        btnAdminChiudi.innerText = "🛑 CHIUDI";
                        btnAdminChiudi.style.background = "#f44336"; // Rosso
                        btnAdminChiudi.onclick = () => {
                            // Chiediamo conferma anche all'Admin per evitare click accidentali
                            disonotify(`Vuoi davvero chiudere il reparto e bloccare le ordinazioni?`, {
                                confirmText: "Sì, Chiudi",
                                showCancel: true,
                                cancelText: "Annulla",
                                onConfirm: async () => {
                                    await db.ref(`impostazioni/chiusuraServizio/chiusi/${rep}`).set(true);
                                    notify(`Reparto chiuso!`, "info");
                                }
                            });
                        };
                    }
                } else {
                    statoSpan.innerHTML = "";
                    btnAdminChiudi.style.display = "none";
                }
            }
        });

        // Aggiorna istantaneamente la cassa
        if (typeof aggiornaBottoniBloccati === "function") aggiornaBottoniBloccati();
    });

    if (btnGestisciChiusure) btnGestisciChiusure.onclick = apriModaleChiusureAdmin;
}

// 3. Modale Admin "Gestisci" (Stile elegante e Filtro Profili Attivi)
function apriModaleChiusureAdmin() {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "10005";

    const modal = document.createElement("div");
    modal.className = "modal-varianti";
    modal.style.width = "400px";

    // Mostra SOLO i reparti attualmente abilitati nelle impostazioni generali
    let reparti = [
        { id: "cucina", nome: "Cucina", attivo: true },
        { id: "bere", nome: "Bere", attivo: true },
        { id: "snack", nome: "Snack", attivo: window.settings.snackAbilitato },
        { id: "extra1", nome: window.nomiRepartiExtra?.extra1 || "Extra 1", attivo: window.settings.extra1Abilitato },
        { id: "extra2", nome: window.nomiRepartiExtra?.extra2 || "Extra 2", attivo: window.settings.extra2Abilitato },
        { id: "extra3", nome: window.nomiRepartiExtra?.extra3 || "Extra 3", attivo: window.settings.extra3Abilitato }
    ].filter(r => r.attivo);

    let html = `
        <h3 style="margin-top:0;">Permessi di Chiusura</h3>
        <p style="font-size:0.9em; color:#777; text-align:center; margin-bottom: 20px;">
            Spunta i reparti che possono chiudere in autonomia le ordinazioni.
        </p>
        <div style="display:flex; flex-direction:column; gap:8px; margin-bottom: 20px; text-align:left;">
    `;

    reparti.forEach(r => {
        const isPermesso = window.permessiChiusura[r.id] ? "checked" : "";
        html += `
            <div class="settingItem" style="margin-bottom:0; cursor:pointer; padding: 12px 15px;" onclick="const cb = this.querySelector('input'); cb.checked = !cb.checked; cb.dispatchEvent(new Event('change'));">
                <div class="settingLabel" style="max-width:100%; width:100%; display:flex; justify-content:space-between; align-items:center; flex-direction:row;">
                    <span style="font-size: 1.15em; margin:0;">${r.nome}</span>
                    <input type="checkbox" class="chk-permesso-chiusura" data-rep="${r.id}" ${isPermesso} style="transform:scale(1.4); cursor:pointer; margin:0;" onclick="event.stopPropagation()">
                </div>
            </div>
        `;
    });

    html += `
        </div>
        <div class="modal-actions" style="display:flex; gap:10px;">
            <button class="btn-chiudi" onclick="this.closest('.modal-overlay').remove()" style="flex:1;">Annulla</button>
            <button class="btn-salva" id="salvaPermessiChiusura" style="flex:1;">Salva</button>
        </div>
    `;

    modal.innerHTML = html;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    document.getElementById("salvaPermessiChiusura").onclick = () => {
        let permessiAggiornati = {};
        document.querySelectorAll(".chk-permesso-chiusura").forEach(chk => {
            permessiAggiornati[chk.dataset.rep] = chk.checked;
        });
        db.ref("impostazioni/chiusuraServizio/permessi").set(permessiAggiornati);
        overlay.remove();
        notify("Permessi salvati!", "success");
    };
}

// 4. Avviso Operatore
function confermaChiusuraOperatore(rep) {
    disonotify("🚨 SEI SICURO DI VOLER CHIUDERE IL REPARTO? \n\nQuesta azione bloccherà i tuoi piatti in Cassa e nei Preordini.\nSolo l'Admin potrà riaprire il servizio.", {
        confirmText: "Sì, Chiudi Servizio",
        showCancel: true,
        cancelText: "Annulla",
        onConfirm: async () => {
            await db.ref(`impostazioni/chiusuraServizio/chiusi/${rep}`).set(true);
            notify("✅ Reparto Chiuso! Non riceverai più ordini.", "info");
        }
    });
}
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
            disonotify("⚠️ Vuoi eliminare le comande attuali e azzerare la cassa? (Se il sistema a giornate è attivo, verranno eliminati anche tutti gli archivi storici!)", {
                confirmText: "Pialla Tutto 🚨",
                showCancel: true,
                cancelText: "Annulla",
                onConfirm: async () => {
                        try {
                            showLoader();
                            
                            // 1. Cancella comande attuali, PREORDINI, contatore e cassa
                            await db.ref("comande").remove();
                            await db.ref("preordini").remove(); // 🔥 ELIMINA I PREORDINI PENDENTI
                            await db.ref("impostazioni/contatoreComande").set(0); 
                            await db.ref("impostazioni/fondoCassa").remove(); 
                            
                            // 2. Cancella l'intero archivio delle giornate (se abilitato)
                            await db.ref("storico_giornate").remove();
                            
                            notify("✅ Database completamente resettato (Comande, Preordini e Archivi)!", "info");

                            // Pulisce l'interfaccia UI admin
                            const listaComandeAdmin = document.getElementById("listaComandeAdmin");
                            if (listaComandeAdmin) listaComandeAdmin.innerHTML = "";
                            
                            // Svuota anche l'interfaccia dei preordini (se ti trovi in Admin/Cassa)
                            const listaPreordiniAdmin = document.getElementById("listaPreordiniAdmin");
                            if (listaPreordiniAdmin) listaPreordiniAdmin.innerHTML = "";
                            const listaPreordiniCassa = document.getElementById("listaPreordiniCassa");
                            if (listaPreordiniCassa) listaPreordiniCassa.innerHTML = "";
                            
                            // Resetta il filtro delle statistiche
                            const filtroSelect = document.getElementById("filtroStatistiche");
                            if (filtroSelect) {
                                filtroSelect.innerHTML = `
                                    <option value="correnti">Turno Attuale (Non archiviate)</option>
                                    <option value="tutte">Globale (Tutta la Sagra)</option>
                                `;
                            }
                            
                            // Ricarica la schermata se è in Statistiche
                            if (typeof caricaStatistiche === "function") caricaStatistiche();
                            
                            hideLoader();
                        } catch (err) {
                            console.error(err);
                            hideLoader();
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
    aggiornaSelectRuoliDinamici();
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
        { btnId: "toggleMenuSnackBtn", ref: "impostazioni/menuSnack", setting: "menuSnack", tabSelector: "button[data-tab='menuSnackTab']" },
		{ btnId: "toggleMagazzinoExtra1Btn", ref: "impostazioni/magazzinoExtra1", setting: "magazzinoExtra1", tabSelector: "button[data-tab='ingredientiExtra1Tab']" },
	    { btnId: "toggleMenuExtra1Btn", ref: "impostazioni/menuExtra1", setting: "menuExtra1", tabSelector: "button[data-tab='menuExtra1Tab']" },
	    { btnId: "toggleMagazzinoExtra2Btn", ref: "impostazioni/magazzinoExtra2", setting: "magazzinoExtra2", tabSelector: "button[data-tab='ingredientiExtra2Tab']" },
	    { btnId: "toggleMenuExtra2Btn", ref: "impostazioni/menuExtra2", setting: "menuExtra2", tabSelector: "button[data-tab='menuExtra2Tab']" },
	    { btnId: "toggleMagazzinoExtra3Btn", ref: "impostazioni/magazzinoExtra3", setting: "magazzinoExtra3", tabSelector: "button[data-tab='ingredientiExtra3Tab']" },
	    { btnId: "toggleMenuExtra3Btn", ref: "impostazioni/menuExtra3", setting: "menuExtra3", tabSelector: "button[data-tab='menuExtra3Tab']" }
		
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
	// ================= GIOCO SCONTRINO =================
	const toggleGiocoScontrinoBtn = document.getElementById("toggleGiocoScontrinoBtn");
	const giocoScontrinoRef = db.ref("impostazioni/giocoScontrino");
	if (toggleGiocoScontrinoBtn) {
	    initToggle(toggleGiocoScontrinoBtn, giocoScontrinoRef, {on: "ON", off: "OFF"}, false, val => {
	        window.settings.giocoScontrino = val;
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
	// ================= SISTEMA A GIORNATE =================
	const toggleGiornateBtn = document.getElementById("toggleGiornateBtn");
	const boxArchivia = document.getElementById("boxArchiviaComande");
	const giornateRef = db.ref("impostazioni/sistemaGiornateAbilitato");
	
	if (toggleGiornateBtn) {
	    initToggle(toggleGiornateBtn, giornateRef, {on: "ON", off: "OFF"}, false, val => {
	        window.settings.sistemaGiornateAbilitato = val;
	        // Mostra il box archiviazione se ON, altrimenti lo nasconde
	        if (boxArchivia) boxArchivia.style.display = val ? "flex" : "none";
	        
	    });
	}
	// ================= PULSANTE SVUOTA MENU E DISPENSA =================
    const svuotaMenuDispensaBtn = document.getElementById("svuotaMenuDispensaBtn");
    if (svuotaMenuDispensaBtn) {
        svuotaMenuDispensaBtn.onclick = async () => {
            if (!checkOnline(true)) return;

            disonotify("🚨 ATTENZIONE! Stai per eliminare TUTTI i piatti del menu e TUTTI gli ingredienti dalla dispensa. L'operazione è irreversibile. Sei sicuro?", {
                confirmText: "Sì, distruggi tutto 💣",
                showCancel: true,
                cancelText: "Annulla",
                onConfirm: async () => {
                    try {
                        showLoader();
                        // Radiamo al suolo Menu e Dispensa
                        await db.ref("menu").remove();
                        await db.ref("ingredienti").remove();
                        
                        notify("✅ Menu e Dispensa azzerati completamente!", "success");
                        hideLoader();
                    } catch (err) {
                        console.error(err);
                        hideLoader();
                        notify("❌ Errore durante l'eliminazione: " + err.message, "error");
                    }
                },
                onCancel: () => {
                    notify("Operazione annullata", "attenzione");
                }
            });
        };
    }
	// ================= PROFILI EXTRA =================
    ["extra1", "extra2", "extra3"].forEach(prof => {
        const CapProf = prof.charAt(0).toUpperCase() + prof.slice(1);
        const toggleBtn = document.getElementById("toggle" + CapProf + "Btn");
        const ref = db.ref("impostazioni/" + prof + "Abilitato");
        const fallbackRef = db.ref("impostazioni/fallback" + CapProf);
        const dependentDiv = document.getElementById(prof + "DependentSettings");

        // Ascolta in tempo reale dove vanno i piatti quando l'extra è disabilitato
        fallbackRef.on("value", snap => {
            window.settings["fallback" + CapProf] = snap.val();
        });

        // Funzione per mostrare/nascondere le impostazioni specifiche del reparto
        function updateDependentVisibility(val) {
            if (dependentDiv) dependentDiv.style.display = val ? "block" : "none";
        }

        if (toggleBtn) {
            // Usa initToggle per mantenere aggiornata l'interfaccia UI
            initToggle(toggleBtn, ref, {on: "ON", off: "OFF"}, false, val => {
                window.settings[prof + "Abilitato"] = val;
                updateDependentVisibility(val);
                aggiornaSelectRuoliDinamici(); 
                if (typeof aggiornaTickSnackPreordini === "function") aggiornaTickSnackPreordini();
            });

            // 🔹 SOVRASCRIVIAMO IL CLICK PER INSERIRE IL MODALE DI DESTINAZIONE
            toggleBtn.onclick = async () => {
                if (!checkOnline(true)) return;
                toggleBtn.disabled = true;
                const currentState = window.settings[prof + "Abilitato"];
                const nextState = !currentState;
                
                if (!nextState) {
                    // --- 1. CONTROLLO PIATTI: Ci sono piatti in questo reparto? ---
                    const snapMenu = await db.ref("menu").once("value");
                    const menuData = snapMenu.val() || {};
                    let hasPiatti = false;
                    const catCercata = prof.toLowerCase(); // es. "extra1"
                    const nomeCustom = (window.nomiRepartiExtra?.[prof] || "").toLowerCase().trim();

                    for (const key in menuData) {
                        let catPiatto = (menuData[key].categoria || "cibi").toLowerCase().trim();
                        // Controlla se il piatto ha la categoria dell'extra o il suo nome personalizzato
                        if (catPiatto === catCercata || (nomeCustom && catPiatto === nomeCustom) || (catCercata === "extra1" && catPiatto === "risto")) {
                            hasPiatti = true;
                            break; // Ne basta 1 per far aprire il popup
                        }
                    }

                    // Se il menù di questa categoria è VUOTO, disattiva subito senza fare domande
                    if (!hasPiatti) {
                        try {
                            await fallbackRef.remove(); // Pulisce vecchi reindirizzamenti
                            await ref.set(false); // Spegne il reparto
                        } catch(e) { console.error(e); }
                        setTimeout(() => { toggleBtn.disabled = false; }, 300);
                        return; // 🛑 IMPORTANTISSIMO: Ferma l'esecuzione qui, non apre il popup!
                    }
                    // --- FINE CONTROLLO PIATTI ---

                    // 2. SE SIAMO QUI, SIGNIFICA CHE CI SONO PIATTI: Mostriamo il Popup
                    const nomeReparto = window.nomiRepartiExtra?.[prof] || CapProf;
                    
                    const opzioni = [
                        { val: "cibo", label: "Cucina" },
                        { val: "bere", label: "Bere" }
                    ];
                    if (window.settings.snackAbilitato) opzioni.push({ val: "snack", label: "Snack" });
                    
                    ["extra1", "extra2", "extra3"].forEach(altroProf => {
                        if (altroProf !== prof && window.settings[altroProf + "Abilitato"]) {
                            opzioni.push({ val: altroProf, label: window.nomiRepartiExtra?.[altroProf] || altroProf.toUpperCase() });
                        }
                    });

                    const optionsHtml = opzioni.map(o => `<option value="${o.val}">${o.label}</option>`).join("");
                    
                    const overlay = document.createElement("div");
                    overlay.className = "modal-overlay";
                    overlay.style.zIndex = "10005";
                    
                    const modal = document.createElement("div");
                    modal.className = "modal-varianti";
                    modal.style.padding = "25px";
                    modal.style.textAlign = "center";
                    
                    modal.innerHTML = `
                        <h3 style="margin-bottom: 15px; color: #333;">Disattiva ${nomeReparto}</h3>
                        <p style="font-size: 0.95em; color: #555; margin-bottom: 15px;">
                            Scegli in quale reparto inviare i piatti di <b>${nomeReparto}</b> finché è spento:
                        </p>
                        <select id="fallbackSelect_${prof}" style="width: 100%; padding: 10px; margin-bottom: 20px; border-radius: 6px; border: 1px solid #ccc; font-size: 1.1em; font-weight: bold; outline: none;">
                            ${optionsHtml}
                        </select>
                        <div class="modal-actions" style="display: flex; gap: 10px;">
                            <button class="btn-chiudi" id="btnAnnullaFallback_${prof}" style="flex: 1; margin:0;">Annulla</button>
                            <button class="btn-salva" id="btnConfermaFallback_${prof}" style="flex: 1; margin:0; background-color: #f44336; color: white;">Disattiva Reparto</button>
                        </div>
                    `;
                    overlay.appendChild(modal);
                    document.body.appendChild(overlay);

                    document.getElementById(`btnAnnullaFallback_${prof}`).onclick = () => {
                        overlay.remove();
                        toggleBtn.disabled = false;
                    };
                    
                    document.getElementById(`btnConfermaFallback_${prof}`).onclick = async () => {
                        const dest = document.getElementById(`fallbackSelect_${prof}`).value;
                        document.getElementById(`btnConfermaFallback_${prof}`).innerText = "Salvataggio...";
                        document.getElementById(`btnConfermaFallback_${prof}`).disabled = true;
                        try {
                            await fallbackRef.set(dest);
                            await ref.set(false);
                            overlay.remove();
                        } catch(e) { console.error(e); }
                        setTimeout(() => { toggleBtn.disabled = false; }, 300);
                    };
                } else {
                    // STIAMO RIATTIVANDO IL REPARTO
                    try {
                        await fallbackRef.remove(); // Rimuoviamo il fallback, torna indipendente
                        await ref.set(true);
                    } catch(e) { console.error(e); }
                    setTimeout(() => { toggleBtn.disabled = false; }, 300);
                }
            };
        }
        
        // Nuove in alto extra
        const toggleNuoveBtn = document.getElementById("toggleNuoveInAlto" + prof.charAt(0).toUpperCase() + prof.slice(1) + "Btn");
        const nuoveRef = db.ref("impostazioni/nuoveInAlto" + prof.charAt(0).toUpperCase() + prof.slice(1));
        if (toggleNuoveBtn) {
		    initToggle(toggleNuoveBtn, nuoveRef, {on:"ON", off:"OFF"}, false, val => { 
		        window.settings["nuoveInAlto" + prof.charAt(0).toUpperCase() + prof.slice(1)] = val; 
		        
		        // Applica l'ordine in tempo reale se stiamo simulando/utilizzando quel reparto
		        if (ruolo === prof) {
		            caricaComandePerRuolo(
		                document.getElementById("da" + prof.charAt(0).toUpperCase() + prof.slice(1) + "ComandeContainer"),
		                document.getElementById("storico" + prof.charAt(0).toUpperCase() + prof.slice(1) + "ComandeContainer"),
		                prof
		            );
		        }
		    });
		}
    });
	// 🔹 ASPORTO AUTOMATICO PREORDINI
    const togglePreordiniAsportoAutoBtn = document.getElementById("togglePreordiniAsportoAutoBtn");
    const preordiniAsportoAutoRef = db.ref("impostazioni/preordiniAsportoAutomatico");
    
    if (togglePreordiniAsportoAutoBtn) {
        initToggle(togglePreordiniAsportoAutoBtn, preordiniAsportoAutoRef, {on:"ON", off:"OFF"}, false, val => {
            window.settings.preordiniAsportoAutomatico = val;
        });

        // Mostra il bottone nelle impostazioni solo se i preordini sono abilitati
        db.ref("impostazioni/preordiniAbilitati").on("value", snap => {
            const preordiniOn = snap.exists() && snap.val() === true;
            togglePreordiniAsportoAutoBtn.parentElement.style.display = preordiniOn ? "flex" : "none";
        });
    }
	// ================= COPERTO E COSTO ASPORTO =================
    const copertoRef = db.ref("impostazioni/copertoAbilitato");
    const copertoValRef = db.ref("impostazioni/copertoValore");
    const costoAsportoRef = db.ref("impostazioni/costoAsportoAbilitato");
    const costoAsportoValRef = db.ref("impostazioni/costoAsportoValore");

    copertoValRef.on("value", snap => window.settings.copertoValore = snap.val() || 0);
    costoAsportoValRef.on("value", snap => window.settings.costoAsportoValore = snap.val() || 0);

    const toggleCopertoBtn = document.getElementById("toggleCopertoBtn");
    const btnCopertoCassa = document.getElementById("btnCopertoCassa");
    
    if (toggleCopertoBtn) {
        initToggle(toggleCopertoBtn, copertoRef, {on:"ON", off:"OFF"}, false, val => {
            window.settings.copertoAbilitato = val;
            if(btnCopertoCassa) btnCopertoCassa.style.display = val ? "inline-block" : "none";
        });

        toggleCopertoBtn.onclick = async () => {
            if(!checkOnline(true)) return;
            const currentState = window.settings.copertoAbilitato;
            if(!currentState) { 
                // APRE IL POPUP CUSTOM INVECE DEL PROMPT
                chiediValoreConPopup("🍽️ Imposta Coperto", "Inserisci il costo del coperto a persona in €:", "1.50", async (val) => {
                    if(val !== null) {
                        val = val.replace(",", "."); 
                        const num = parseFloat(val);
                        if(!isNaN(num)) {
                            await copertoValRef.set(num);
                            await copertoRef.set(true);
                        } else { notify("Valore non valido", "error"); }
                    }
                });
            } else { await copertoRef.set(false); }
        };
    }

    const toggleCostoAsportoBtn = document.getElementById("toggleCostoAsportoBtn");
    if (toggleCostoAsportoBtn) {
        initToggle(toggleCostoAsportoBtn, costoAsportoRef, {on:"ON", off:"OFF"}, false, val => {
            window.settings.costoAsportoAbilitato = val;
        });

       toggleCostoAsportoBtn.onclick = async () => {
            if(!checkOnline(true)) return;
            const currentState = window.settings.costoAsportoAbilitato;
            if(!currentState) { 
                // APRE IL POPUP CUSTOM INVECE DEL PROMPT
                chiediValoreConPopup("📦 Costo Asporto", "Inserisci il costo fisso per l'asporto in €:", "2.00", async (val) => {
                    if(val !== null) {
                        val = val.replace(",", ".");
                        const num = parseFloat(val);
                        if(!isNaN(num)) {
                            await costoAsportoValRef.set(num);
                            await costoAsportoRef.set(true);
                        } else { notify("Valore non valido", "error"); }
                    }
                });
            } else { await costoAsportoRef.set(false); }
        };
    }
	// ================= ANNULLAMENTO ULTIMA VENDITA =================
    const toggleAnnullamentoVenditaBtn = document.getElementById("toggleAnnullamentoVenditaBtn");
    const annullamentoVenditaRef = db.ref("impostazioni/annullamentoVendita");
    const settingTempoAnnullamento = document.getElementById("settingTempoAnnullamento");
    const inputTempoAnnullamento = document.getElementById("inputTempoAnnullamento");

    if (toggleAnnullamentoVenditaBtn) {
        initToggle(toggleAnnullamentoVenditaBtn, annullamentoVenditaRef, {on: "ON", off: "OFF"}, false, val => {
            window.settings.annullamentoVendita = val;
            if (settingTempoAnnullamento) settingTempoAnnullamento.style.display = val ? "flex" : "none";
        });
    }

    const tempoAnnullamentoRef = db.ref("impostazioni/tempoAnnullamento");
    if (inputTempoAnnullamento) {
        tempoAnnullamentoRef.on("value", snap => {
            const val = snap.val() || 30;
            window.settings.tempoAnnullamento = parseInt(val, 10);
            inputTempoAnnullamento.value = val;
        });

        inputTempoAnnullamento.addEventListener("change", () => {
            let val = parseInt(inputTempoAnnullamento.value, 10);
            if (isNaN(val) || val < 5) val = 5;
            tempoAnnullamentoRef.set(val);
        });
    }
	// ================= MODALITA' NOTTE AUTOMATICA =================
    const toggleModalitaNotteBtn = document.getElementById("toggleModalitaNotteBtn");
    const modalitaNotteRef = db.ref("impostazioni/modalitaNotte");

    if (toggleModalitaNotteBtn) {
        initToggle(toggleModalitaNotteBtn, modalitaNotteRef, {on: "ON", off: "OFF"}, false, val => {
            // Il cambiamento nel DB innescherà automaticamente il listener globale creato prima,
            // quindi non serve fare altro qui!
            console.log("Modalità notte automatica impostata su:", val);
        });
    }
	// ================= SCORCIATOIE DA TASTIERA =================
    const toggleScorciatoieBtn = document.getElementById("toggleScorciatoieBtn");
    const scorciatoieRef = db.ref("impostazioni/scorciatoieTastiera");
    
    if (toggleScorciatoieBtn) {
        let isFirstLoadScorciatoie = true;
        initToggle(toggleScorciatoieBtn, scorciatoieRef, {on: "ON", off: "OFF"}, false, val => {
            window.settings.scorciatoieTastiera = val;
            
            // Se abilitato e non è il primissimo caricamento silente all'avvio, apriamo il tutorial
            if (val && !isFirstLoadScorciatoie) {
                apriTutorialScorciatoie();
            }
            isFirstLoadScorciatoie = false;
        });
    }
	// ================= NUMERO TAVOLO =================
	const toggleTavoloBtn = document.getElementById("toggleTavoloBtn");
	const tavoloRef = db.ref("impostazioni/richiediTavolo");
	
	if (toggleTavoloBtn) {
	    initToggle(toggleTavoloBtn, tavoloRef, {on: "ON", off: "OFF"}, false, val => {
	        window.settings.richiediTavolo = val;
	        
	        // Mostra o nascondi il campo in Cassa
	        const containerTavolo = document.getElementById("containerTavoloCassa");
	        if (containerTavolo) {
	            containerTavolo.style.display = val ? "inline-block" : "none";
	        }
	    });
	}
	// ================= QR CODE STATO ORDINE =================
	const toggleQrCodeStatoBtn = document.getElementById("toggleQrCodeStatoBtn");
	const qrCodeStatoRef = db.ref("impostazioni/qrCodeStatoOrdine");
	if (toggleQrCodeStatoBtn) {
	    initToggle(toggleQrCodeStatoBtn, qrCodeStatoRef, {on: "ON", off: "OFF"}, false, val => {
	        window.settings.qrCodeStatoOrdine = val;
	    });
	}
}
function initTickNoteDestinazioni() {
    db.ref("impostazioni/noteDestinazioniAbilitate").on("value", snap => {
        const attivo = !!snap.val();
        window.settings.noteDestinazioniAbilitate = attivo;
        const div = document.getElementById("noteDestinazioniDiv");
        if (div) div.style.display = attivo ? "block" : "none";
    });

    // Mostra tick in base ai profili attivi E usa il nome personalizzato
    ["snack", "extra1", "extra2", "extra3"].forEach(prof => {
        db.ref("impostazioni/" + prof + "Abilitato").on("value", snap => {
            const attivo = !!snap.val();
            const labelId = "tick" + prof.charAt(0).toUpperCase() + prof.slice(1) + "Label";
            const label = document.getElementById(labelId);
            
            if (label) {
                label.style.display = attivo ? "inline" : "none";
                if (prof !== "snack") {
                    const nomeReparto = window.nomiRepartiExtra?.[prof] || `Extra ${prof.replace('extra','')}`;
                    label.innerHTML = `<input type="checkbox" id="tick${prof.charAt(0).toUpperCase() + prof.slice(1)}"> ${nomeReparto}`;
                }
            }
        });
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

            const destinazioni = ["cucina","bere"];
            if (window.settings.snackAbilitato) destinazioni.push("snack");
            if (window.settings.extra1Abilitato) destinazioni.push("extra1");
            if (window.settings.extra2Abilitato) destinazioni.push("extra2");
            if (window.settings.extra3Abilitato) destinazioni.push("extra3");

            container.innerHTML = destinazioni.map(d => `
                <label style="margin-right:10px;">
                    <input type="checkbox" class="note-destinazione" data-id="${id}" data-destinazione="${d}" 
                        ${p.noteDestinazioni?.includes(d) ? "checked" : ""}>
                    ${d.startsWith('extra') ? (window.nomiRepartiExtra?.[d] || d.charAt(0).toUpperCase() + d.slice(1)) : d.charAt(0).toUpperCase() + d.slice(1)}
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
// ================= ARCHIVIA COMANDE =================
// ================= ARCHIVIA COMANDE =================
const archiviaComandeBtn = document.getElementById("archiviaComandeBtn");
const archiviaComandeStatsBtn = document.getElementById("archiviaComandeStatsBtn");

async function apriModaleArchiviazione() {
    if (!checkOnline(true)) return;

    // Controlliamo se ci sono comande da archiviare
    const snapComande = await db.ref("comande").once("value");
    if (!snapComande.exists()) {
        notify("⚠️ Nessuna comanda presente da archiviare.", "warn");
        return;
    }

    // Generiamo un nome di default (es: "15/08/2026 - 23:30")
    const now = new Date();
    const defaultName = `${now.toLocaleDateString('it-IT')} - ${now.toLocaleTimeString('it-IT', {hour: '2-digit', minute:'2-digit'})}`;

    // Creiamo un modale personalizzato per chiedere il nome del turno
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "10005";
    
    const modal = document.createElement("div");
    modal.className = "modal-varianti";
    modal.style.padding = "25px";
    modal.style.boxSizing = "border-box";
    modal.innerHTML = `
        <h3 style="margin-bottom: 10px;">📦 Archivia Turno</h3>
        <p style="font-size: 0.9em; color: #555; margin-bottom: 15px;">Le comande verranno rimosse dai monitor attuali e salvate nello storico.</p>
        <label style="display:block; text-align:left; font-weight:bold; margin-bottom:5px;">Nome Turno / Giornata:</label>
        <input type="text" id="nomeTurnoInput" value="Turno ${defaultName}" style="width: 100%; box-sizing: border-box; padding: 10px; margin-bottom: 10px; border-radius: 6px; border: 1px solid #ccc; font-size: 1.1em; outline: none;">
        
        <div class="modal-actions" style="margin-top: 20px; display: flex; gap: 10px;">
            <button class="btn-chiudi" id="annullaArchiviaBtn" style="flex: 1; margin:0;">Annulla</button>
            <button class="btn-salva" id="confermaArchiviaBtn" style="flex: 1; margin:0; background-color: #4CAF50;">Archivia Ora</button>
        </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    document.getElementById("annullaArchiviaBtn").onclick = () => overlay.remove();
    
    document.getElementById("confermaArchiviaBtn").onclick = async () => {
        const nomeTurno = document.getElementById("nomeTurnoInput").value.trim() || defaultName;
        document.getElementById("confermaArchiviaBtn").disabled = true;
        document.getElementById("confermaArchiviaBtn").innerText = "Archiviazione...";

        try {
            // 1. Leggi il fondo cassa attuale (se vuoi salvarlo nello storico)
            const snapFondo = await db.ref("impostazioni/fondoCassa").once("value");
            const fondoCassa = snapFondo.val() || 0;

            // 2. Salva in storico_giornate
            const nuovoArchivioRef = db.ref("storico_giornate").push();
            await nuovoArchivioRef.set({
                nome: nomeTurno,
                timestamp: Date.now(),
                fondoCassa: fondoCassa,
                comande: snapComande.val()
            });

            // 3. Cancella le comande attive, il contatore e il fondo cassa
            await db.ref("comande").remove();
            await db.ref("impostazioni/contatoreComande").set(0); 
            await db.ref("impostazioni/fondoCassa").remove(); 

            notify(`✅ Turno "${nomeTurno}" archiviato con successo!`, "success");
            
            // Pulisci l'interfaccia admin
            const listaComandeAdmin = document.getElementById("listaComandeAdmin");
            if (listaComandeAdmin) listaComandeAdmin.innerHTML = "";
            
            // Aggiorna in tempo reale la dashboard statistiche se stiamo guardando quella tab!
            if (typeof caricaStatistiche === "function") caricaStatistiche();

            overlay.remove();
        } catch (error) {
            console.error(error);
            notify("❌ Errore durante l'archiviazione: " + error.message, "error");
            document.getElementById("confermaArchiviaBtn").disabled = false;
        }
    };
}

if (archiviaComandeBtn) {
    archiviaComandeBtn.onclick = apriModaleArchiviazione;
}

if (archiviaComandeStatsBtn) {
    archiviaComandeStatsBtn.onclick = apriModaleArchiviazione;
}
// =====================================================
// 🔹 Aggiunge "Snack" nei menu a tendina ruoli se attivo
// =====================================================
function aggiornaSelectRuoliDinamici() {
    const profili = [
        { id: "snack", attivo: !!window.settings.snackAbilitato, label: "Snack" },
        { id: "extra1", attivo: !!window.settings.extra1Abilitato, label: window.nomiRepartiExtra?.extra1 || "Extra 1" },
        { id: "extra2", attivo: !!window.settings.extra2Abilitato, label: window.nomiRepartiExtra?.extra2 || "Extra 2" },
        { id: "extra3", attivo: !!window.settings.extra3Abilitato, label: window.nomiRepartiExtra?.extra3 || "Extra 3" }
    ];

    ["regRole", "newRole"].forEach(selectId => {
        const selectEl = document.getElementById(selectId);
        if (!selectEl) return;
        
        profili.forEach(prof => {
            const optEsistente = selectEl.querySelector(`option[value='${prof.id}']`);
            if (prof.attivo) {
                if (!optEsistente) {
                    const opt = document.createElement("option");
                    opt.value = prof.id;
                    opt.textContent = prof.label;
                    selectEl.appendChild(opt);
                } else {
                    optEsistente.textContent = prof.label; // Aggiorna il nome se viene rinominato!
                }
            } else if (!prof.attivo && optEsistente) {
                optEsistente.remove();
            }
        });
    });
}
// 🔹 Popola un select ruoli aggiungendo "Snack" solo se abilitato
// 🔹 Popola un select ruoli aggiungendo "Snack" e "Extra" solo se abilitati, recuperandone anche i nomi
async function popolaSelectRuoliConSnack(selectEl) {
    if (!selectEl) return;

    try {
        // Leggiamo tutto il nodo impostazioni in un colpo solo per avere sia le abilitazioni che i nomi custom
        const snap = await db.ref("impostazioni").once("value");
        const imp = snap.val() || {};

        const snackAttivo = !!imp.snackAbilitato;
        const extra1Attivo = !!imp.extra1Abilitato;
        const extra2Attivo = !!imp.extra2Abilitato;
        const extra3Attivo = !!imp.extra3Abilitato;
        
        const nomiExtra = imp.nomiRepartiExtra || {};

        // Ripulisci select e ripopola
        selectEl.innerHTML = '<option value="" selected>-- Seleziona ruolo --</option>';
        
        // Inseriamo i ruoli fissi
        const ruoliFissi = ["cassa", "cucina", "bere"];
        ruoliFissi.forEach(r => {
            const opt = document.createElement("option");
            opt.value = r;
            opt.textContent = r.charAt(0).toUpperCase() + r.slice(1);
            selectEl.appendChild(opt);
        });

        // Aggiungiamo quelli dinamici
        if (snackAttivo) {
            const opt = document.createElement("option");
            opt.value = "snack";
            opt.textContent = "Snack";
            selectEl.appendChild(opt);
        }

        if (extra1Attivo) {
            const opt = document.createElement("option");
            opt.value = "extra1";
            opt.textContent = nomiExtra.extra1 || "Extra 1";
            selectEl.appendChild(opt);
        }
        if (extra2Attivo) {
            const opt = document.createElement("option");
            opt.value = "extra2";
            opt.textContent = nomiExtra.extra2 || "Extra 2";
            selectEl.appendChild(opt);
        }
        if (extra3Attivo) {
            const opt = document.createElement("option");
            opt.value = "extra3";
            opt.textContent = nomiExtra.extra3 || "Extra 3";
            selectEl.appendChild(opt);
        }

    } catch (err) {
        console.warn("Errore lettura impostazioni ruoli:", err);
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
        // Se c'è una soglia personalizzata salvata usa quella, altrimenti usa i default
        const sogliaAtt = (ing.sogliaAttenzione !== undefined && ing.sogliaAttenzione !== null && ing.sogliaAttenzione !== "") ? Number(ing.sogliaAttenzione) : (sogliePerUnita[unita]?.attenzione ?? 15);
        const sogliaCrit = (ing.sogliaCritica !== undefined && ing.sogliaCritica !== null && ing.sogliaCritica !== "") ? Number(ing.sogliaCritica) : (sogliePerUnita[unita]?.critica ?? 5);

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
    
    const divId = ruolo === "cucina" ? "cucinaDiv" : 
                  ruolo === "snack" ? "snackDiv" : 
                  ruolo === "extra1" ? "extra1Div" : 
                  ruolo === "extra2" ? "extra2Div" : 
                  ruolo === "extra3" ? "extra3Div" : "bereDiv";

    const daFareTabId = ruolo === "cucina" ? "daFareTab" : 
                        ruolo === "snack" ? "daSnackTab" : 
                        ruolo === "extra1" ? "daExtra1Tab" : 
                        ruolo === "extra2" ? "daExtra2Tab" : 
                        ruolo === "extra3" ? "daExtra3Tab" : "daBereTab";

    const storicoTabId = ruolo === "cucina" ? "storicoTab" : 
                         ruolo === "snack" ? "storicoSnackTab" : 
                         ruolo === "extra1" ? "storicoExtra1Tab" : 
                         ruolo === "extra2" ? "storicoExtra2Tab" : 
                         ruolo === "extra3" ? "storicoExtra3Tab" : "storicoBereTab";

    if (ruolo === "cucina") {
        initRicercaComande("daFareComandeContainer", "cercaComandaCucina");
        initRicercaComande("storicoComandeContainer", "cercaComandaCucinaStorico");
    } else if (ruolo === "bere") {
        initRicercaComande("daBereComandeContainer", "cercaComandaBere");
        initRicercaComande("storicoBereComandeContainer", "cercaComandaBereStorico");
    } else if (ruolo === "snack") {
        initRicercaComande("daSnackComandeContainer", "cercaComandaSnack");
        initRicercaComande("storicoSnackComandeContainer", "cercaComandaSnackStorico");
    } else if (ruolo === "extra1") {
        initRicercaComande("daExtra1ComandeContainer", "cercaComandaExtra1");
        initRicercaComande("storicoExtra1ComandeContainer", "cercaComandaExtra1Storico");
    } else if (ruolo === "extra2") {
        initRicercaComande("daExtra2ComandeContainer", "cercaComandaExtra2");
        initRicercaComande("storicoExtra2ComandeContainer", "cercaComandaExtra2Storico");
    } else if (ruolo === "extra3") {
        initRicercaComande("daExtra3ComandeContainer", "cercaComandaExtra3");
        initRicercaComande("storicoExtra3ComandeContainer", "cercaComandaExtra3Storico");
    }

    const menuTabId = ruolo === "cucina" ? "menuCucinaTab" : 
                      ruolo === "snack" ? "menuSnackTab" : 
                      ruolo === "extra1" ? "menuExtra1Tab" : 
                      ruolo === "extra2" ? "menuExtra2Tab" : 
                      ruolo === "extra3" ? "menuExtra3Tab" : "menuBereTab";

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
    } else if (ruolo === "extra1") {
        daFareCont = document.getElementById("daExtra1ComandeContainer");
        storicoCont = document.getElementById("storicoExtra1ComandeContainer");
    } else if (ruolo === "extra2") {
        daFareCont = document.getElementById("daExtra2ComandeContainer");
        storicoCont = document.getElementById("storicoExtra2ComandeContainer");
    } else if (ruolo === "extra3") {
        daFareCont = document.getElementById("daExtra3ComandeContainer");
        storicoCont = document.getElementById("storicoExtra3ComandeContainer");
    }
    caricaComandePerRuolo(daFareCont, storicoCont, ruolo);

    // Mostra tab di default "Da fare"
    document.getElementById(daFareTabId).classList.add("active");

    // Carica ingredienti per il ruolo
    caricaIngredientiPerRuolo(ruolo);

    // ------------------- Popola il tab Menu informativo -------------------
   const menuContainer = ruolo === "cucina" ? document.getElementById("menuCucinaContainer") : 
                          ruolo === "bere" ? document.getElementById("menuBereContainer") :
                          ruolo === "snack" ? document.getElementById("menuSnackContainer") :
                          ruolo === "extra1" ? document.getElementById("menuExtra1Container") :
                          ruolo === "extra2" ? document.getElementById("menuExtra2Container") :
                          document.getElementById("menuExtra3Container");

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
        } else if (["snack", "extra1", "extra2", "extra3"].includes(ruolo)) {
            const abilita = ruolo === "snack" ? (window.settings?.snackAbilitato || false) : true;
            if (abilita) {
                const items = Object.values(data).filter(i => i.categoria?.toLowerCase() === ruolo);
                if (items.length > 0) {
                    const title = document.createElement("h4");
                    // Mette l'iniziale maiuscola
                    title.innerText = ruolo.charAt(0).toUpperCase() + ruolo.slice(1);
                    menuContainer.appendChild(title);

                    items.forEach(item => {
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

            // 1. Capiamo quali categorie appartengono a questo monitor (comprese quelle deviate!)
            let categorieRuolo = [];
            if (ruolo === "cucina") categorieRuolo.push("cibi");
            else if (ruolo === "bere") categorieRuolo.push("bevande");
            else if (["snack", "extra1", "extra2", "extra3"].includes(ruolo)) {
                if (window.settings[ruolo + "Abilitato"]) categorieRuolo.push(ruolo);
            }

            // Aggiungiamo lo Snack alla Cucina se è spento
            if (ruolo === "cucina" && !window.settings.snackAbilitato) categorieRuolo.push("snack");

            // Aggiungiamo gli Extra a questo monitor se sono spenti e hanno noi come Fallback!
            ["extra1", "extra2", "extra3"].forEach(ex => {
                if (!window.settings[ex + "Abilitato"]) {
                    let CapProf = ex.charAt(0).toUpperCase() + ex.slice(1);
                    let fallback = window.settings["fallback" + CapProf] || "cibo";
                    let targetRuolo = fallback === "cibo" ? "cucina" : fallback;
                    if (targetRuolo === ruolo) categorieRuolo.push(ex);
                }
            });

            // 2. Disegniamo il menu solo per le categorie trovate
            categorieRuolo.forEach(catReq => {
                const items = Object.values(data).filter(i => {
                    let cat = (i.categoria || "cibi").toLowerCase().trim();
                    const lE1 = (window.nomiRepartiExtra?.extra1 || "").toLowerCase().trim();
                    const lE2 = (window.nomiRepartiExtra?.extra2 || "").toLowerCase().trim();
                    const lE3 = (window.nomiRepartiExtra?.extra3 || "").toLowerCase().trim();
                    if (cat === "extra1" || cat === "risto" || (lE1 && cat === lE1)) cat = "extra1";
                    else if (cat === "extra2" || (lE2 && cat === lE2)) cat = "extra2";
                    else if (cat === "extra3" || (lE3 && cat === lE3)) cat = "extra3";
                    
                    return cat === catReq;
                });

                if (items.length > 0) {
                    const title = document.createElement("h4");
                    let realName = catReq.charAt(0).toUpperCase() + catReq.slice(1);
                    if (catReq.startsWith("extra")) realName = window.nomiRepartiExtra?.[catReq] || realName;
                    title.innerText = realName;
                    menuContainer.appendChild(title);

                    items.forEach(item => {
                        const divPiatto = creaPiattoDiv(item);
                        menuContainer.appendChild(divPiatto);
                        aggiungiIngredienti(item, menuContainer);
                    });
                }
            });

            if (menuContainer.innerHTML === "") {
                menuContainer.innerHTML = `<div style="text-align:center; padding: 30px; color: #777; font-style: italic; font-size: 1.1em; background: #f9f9f9; border-radius: 10px; margin-top: 20px;">Niente da vedere qui! 😴🍳</div>`;
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
	document.getElementById("extra1Div").classList.add("hidden");
    document.getElementById("extra2Div").classList.add("hidden");
    document.getElementById("extra3Div").classList.add("hidden");

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
        setTimeout(() => {
            const dashBtn = document.querySelector("#adminDiv .tabBtn[data-tab='dashboardAdminTab']");
            if (dashBtn) dashBtn.click();
        }, 100);

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
   } else if (["cucina", "bere", "snack", "extra1", "extra2", "extra3"].includes(ruolo)) {
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
        
        // --- INIZIO MODIFICA NOME REPARTO ---
        let displayRuolo = msg.ruolo || "sconosciuto";
        if (displayRuolo.startsWith("extra")) {
            // Cerca il nome personalizzato globale, altrimenti usa un fallback
            displayRuolo = window.nomiRepartiExtra?.[displayRuolo] || displayRuolo.charAt(0).toUpperCase() + displayRuolo.slice(1);
        } else {
            // Capitalizza l'iniziale per ruoli come "cucina", "cassa", "bere"
            displayRuolo = displayRuolo.charAt(0).toUpperCase() + displayRuolo.slice(1);
        }
        // --- FINE MODIFICA ---

        sender.textContent = msg.uid === uid ? "Tu" : `${msg.email} (${displayRuolo})`;

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
            
            // --- INIZIO MODIFICA NOME REPARTO PER NOTIFICA ---
            let displayRuolo = msg.ruolo || "sconosciuto";
            if (displayRuolo.startsWith("extra")) {
                displayRuolo = window.nomiRepartiExtra?.[displayRuolo] || displayRuolo.charAt(0).toUpperCase() + displayRuolo.slice(1);
            } else {
                displayRuolo = displayRuolo.charAt(0).toUpperCase() + displayRuolo.slice(1);
            }
            // --- FINE MODIFICA ---

            notify(`💬 Nuovo messaggio da: ${msg.email} (${displayRuolo})`, "info");

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
	document.getElementById("extra1Div").classList.add("hidden");
    document.getElementById("extra2Div").classList.add("hidden");
    document.getElementById("extra3Div").classList.add("hidden");
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
	document.getElementById("extra1Div").classList.add("hidden");
    document.getElementById("extra2Div").classList.add("hidden");
    document.getElementById("extra3Div").classList.add("hidden");

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
    if (!Array.isArray(items)) return { cibo: [], bere: [], snack: [], extra1: [], extra2: [], extra3: [] };

    let cibo = [], bere = [], snack = [], extra1 = [], extra2 = [], extra3 = [];

    // 🔹 FIX: Supporto robusto per le impostazioni
    const s = window.settings || {};
    const snackAbilitato = s.snackAbilitato === true || s.snackAbilitato === "true";
    const extra1Abilitato = s.extra1Abilitato === true || s.extra1Abilitato === "true";
    const extra2Abilitato = s.extra2Abilitato === true || s.extra2Abilitato === "true";
    const extra3Abilitato = s.extra3Abilitato === true || s.extra3Abilitato === "true";

    function getDest(categoria, tipo, nome) {
        const cat = (categoria || "").trim().toLowerCase();
        const tip = (tipo || "").trim().toLowerCase();
        const nom = (nome || "").trim().toLowerCase();

        // 🔹 FIX: Estraiamo correttamente i nomi (es: "risto")
        const lE1 = (window.nomiRepartiExtra?.extra1 || "").trim().toLowerCase();
        const lE2 = (window.nomiRepartiExtra?.extra2 || "").trim().toLowerCase();
        const lE3 = (window.nomiRepartiExtra?.extra3 || "").trim().toLowerCase();

        if (cat === "bevande" || tip === "bere") return "bere";
        
        // Incanaliamo le comande nel posto giusto
        // Incanaliamo le comande nel posto giusto in base al Fallback scelto
        if (cat === "extra1" || tip === "extra1" || (lE1 && (cat === lE1 || tip === lE1)) || cat === "risto") return extra1Abilitato ? "extra1" : (window.settings.fallbackExtra1 || "cibo");
        if (cat === "extra2" || tip === "extra2" || (lE2 && (cat === lE2 || tip === lE2))) return extra2Abilitato ? "extra2" : (window.settings.fallbackExtra2 || "cibo");
        if (cat === "extra3" || tip === "extra3" || (lE3 && (cat === lE3 || tip === lE3))) return extra3Abilitato ? "extra3" : (window.settings.fallbackExtra3 || "cibo");
        
        if (cat === "snack" || cat.includes("fritti") || tip === "snack" || nom.includes("patatine") || nom.includes("fritto")) {
            return snackAbilitato ? "snack" : "cibo";
        }
        return "cibo";
    }

    items.forEach(i => {
        // 🔹 IGNORA LE VOCI DI SERVIZIO: NON VANNO NEI MONITOR O SCONTRINI DI REPARTO (Ma andranno nello scontrino cliente!)
        if ((i.categoria || "").toLowerCase().trim() === "servizio") return;

        const destMain = getDest(i.categoria, i.tipo, i.nome);

        let cloneCibo = null, cloneBere = null, cloneSnack = null;
        let cloneExtra1 = null, cloneExtra2 = null, cloneExtra3 = null;

        const getClone = (dest) => {
            if (dest === "cibo") { if (!cloneCibo) cloneCibo = JSON.parse(JSON.stringify({ ...i, isMainHere: false, contorniScelti: [] })); return cloneCibo; }
            if (dest === "bere") { if (!cloneBere) cloneBere = JSON.parse(JSON.stringify({ ...i, isMainHere: false, contorniScelti: [] })); return cloneBere; }
            if (dest === "snack") { if (!cloneSnack) cloneSnack = JSON.parse(JSON.stringify({ ...i, isMainHere: false, contorniScelti: [] })); return cloneSnack; }
            if (dest === "extra1") { if (!cloneExtra1) cloneExtra1 = JSON.parse(JSON.stringify({ ...i, isMainHere: false, contorniScelti: [] })); return cloneExtra1; }
            if (dest === "extra2") { if (!cloneExtra2) cloneExtra2 = JSON.parse(JSON.stringify({ ...i, isMainHere: false, contorniScelti: [] })); return cloneExtra2; }
            if (dest === "extra3") { if (!cloneExtra3) cloneExtra3 = JSON.parse(JSON.stringify({ ...i, isMainHere: false, contorniScelti: [] })); return cloneExtra3; }
        };

        // 1. Assegna il Piatto Principale
        getClone(destMain).isMainHere = true;

        // 2. Smista i Contorni
        if (i.contorniScelti && i.contorniScelti.length > 0) {
            i.contorniScelti.forEach(c => {
                const destC = getDest(c.categoria, "", c.nome);
                
                if (destC !== destMain) {
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
                        varianti: c.varianti ? JSON.parse(JSON.stringify(c.varianti)) : [],
                        contorniScelti: [],
                        ingredienti: [],
                        note: i.note || ""
                    };

                    if (destC === "cibo") cibo.push(splitItem);
                    if (destC === "bere") bere.push(splitItem);
                    if (destC === "snack") snack.push(splitItem);
                    if (destC === "extra1") extra1.push(splitItem);
                    if (destC === "extra2") extra2.push(splitItem);
                    if (destC === "extra3") extra3.push(splitItem);
                } else {
                    getClone(destC).contorniScelti.push(c);
                }
            });
        }

        // 3. Inserisci i cloni finali
        if (cloneCibo && cloneCibo.isMainHere) cibo.push(cloneCibo);
        if (cloneBere && cloneBere.isMainHere) bere.push(cloneBere);
        if (cloneSnack && cloneSnack.isMainHere) snack.push(cloneSnack);
        if (cloneExtra1 && cloneExtra1.isMainHere) extra1.push(cloneExtra1);
        if (cloneExtra2 && cloneExtra2.isMainHere) extra2.push(cloneExtra2);
        if (cloneExtra3 && cloneExtra3.isMainHere) extra3.push(cloneExtra3);
    });

    return { cibo, bere, snack, extra1, extra2, extra3 };
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

        const isOpt = window.settings.cassaOttimizzata;
        const divParent = menuSnackDiv ? menuSnackDiv.parentElement : null;
        
        // Cassa Estesa / Standard Layout (Non ottimizzata)
        if (!isOpt) {
             if (divParent) {
                 divParent.style.display = "block"; // Ripristina layout verticale per la cassa standard
             }
             menuCibiDiv.innerHTML = "<h3 style='margin: 0 0 10px 0; text-align:center;'>Cibi</h3><div class='menu-grid' id='grid-cibi'></div>";
             menuBevandeDiv.innerHTML = "<h3 style='margin: 15px 0 10px 0; text-align:center;'>Bevande</h3><div class='menu-grid' id='grid-bevande'></div>";
             menuSnackDiv.innerHTML = window.settings.snackAbilitato ? "<h3 style='margin: 15px 0 10px 0; text-align:center;'>Snack</h3><div class='menu-grid' id='grid-snack'></div>" : "";
            
            // Funzione di utilità per creare/aggiornare Div extra
            const manageExtraDiv = (id, nome, enabled) => {
                let div = document.getElementById(`menu${id}`);
                if (enabled) {
                    if (!div) {
                        div = document.createElement("div");
                        div.id = `menu${id}`;
                        divParent.insertBefore(div, document.getElementById("scontiGlobaliCassaContainer"));
                    }
                    div.style.display = "block";
                    div.innerHTML = `<h3 style='margin: 15px 0 10px 0; text-align:center;'>${nome}</h3><div class='menu-grid' id='grid-${id.toLowerCase()}'></div>`;
                } else if (div) {
                    div.style.display = "none";
                }
            };

            // 🔹 Mostra SEMPRE gli extra in Cassa se hanno piatti configurati
            manageExtraDiv("Extra1", window.nomiRepartiExtra?.extra1 || "Extra 1", true);
            manageExtraDiv("Extra2", window.nomiRepartiExtra?.extra2 || "Extra 2", true);
            manageExtraDiv("Extra3", window.nomiRepartiExtra?.extra3 || "Extra 3", true);
            
       } else {
             // Layout Cassa Ottimizzata
             // GRIGLIA DINAMICA COMPATTA A PIÙ COLONNE
             if (divParent) {
                 divParent.style.display = "grid";
                 divParent.style.gridTemplateColumns = "repeat(3, 1fr)"; 
                 // Nessuna riga fissa (1fr), lasciamo fare al contenuto!
                 divParent.style.gridAutoRows = "max-content"; 
                 divParent.style.alignContent = "start"; // FONDAMENTALE: spinge tutto in alto compatto
                 divParent.style.gap = "8px";
                 
                 // Adattiamo l'altezza in modo che non superi lo schermo, ma sia "libera" di rimpicciolirsi
                 divParent.style.height = "auto"; 
                 divParent.style.maxHeight = "calc(100vh - 120px)"; 
                 divParent.style.overflow = "hidden"; 
                 
                 const scontiCont = document.getElementById("scontiGlobaliCassaContainer");
                 if (scontiCont) {
                     scontiCont.style.gridColumn = "1 / -1";
                     scontiCont.style.marginTop = "0"; 
                     scontiCont.style.padding = "6px"; 
                 }
             }

             // Inizializza i div (vuoti)
             menuCibiDiv.innerHTML = ""; menuBevandeDiv.innerHTML = ""; menuSnackDiv.innerHTML = "";
             menuCibiDiv.style.display = "none"; menuBevandeDiv.style.display = "none"; menuSnackDiv.style.display = "none";
             
             ["Extra1", "Extra2", "Extra3"].forEach(id => {
                  let cat = id.toLowerCase();
                  let abilitato = window.settings[cat + "Abilitato"];
                  
                  // 🔹 SE IL REPARTO E' SPENTO E VUOTO, NON CREARE IL SUO BOX IN CASSA!
                  if (!abilitato && !window.categoriaHaPiatti(cat)) {
                      let divEx = document.getElementById(`menu${id}`);
                      if (divEx) divEx.style.display = "none";
                      return;
                  }

                  let div = document.getElementById(`menu${id}`);
                  if (!div) {
                        div = document.createElement("div"); div.id = `menu${id}`;
                        const refNode = document.getElementById("scontiGlobaliCassaContainer");
                        // IL FIX: Anche qui ci assicuriamo che l'inserimento non dia errori di gerarchia DOM
                        if (refNode && refNode.parentNode) {
                            refNode.parentNode.insertBefore(div, refNode);
                        } else if (divParent) {
                            divParent.appendChild(div);
                        }
                  }
                  div.innerHTML = ""; div.style.display = "none";
             });
        }

        Object.entries(window.menuData || {}).forEach(([id, item]) => {
            // Creo il bottone sempre nuovo (evita il bug della sparizione!)
            let btn = document.createElement("button");
            btn.className = "piatto-btn";
            btn.dataset.menuId = id;

            btn.onclick = () => {
                // 1. Leggiamo e controlliamo la quantità PRIMA di fare qualsiasi cosa (anche per le Combo)
                let quant = 1; 
                if (window.settings.selettoreQuantitaCassa) {
                    const quantVal = document.getElementById("quantita").value;
                    quant = parseInt(quantVal);
                    if (!quant || quant <= 0) { notify("Seleziona prima la quantità!", "warn"); return; }
                }

                // 2. SE E' UNA COMBO, apriamo il modale speciale (ora bloccato se manca la quantità)
                if (window.settings.piattiComboAbilitati && item.isCombo) {
                    if (typeof apriPopupCombo === "function") apriPopupCombo(id, "cassa");
                    return;
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

            // CREAZIONE CONTENUTO STANDARD (Usato se Cassa Ottimizzata è OFF)
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

          // --- INIZIO GESTIONE LAYOUT (STANDARD O OTTIMIZZATO) ---
            if (window.settings.cassaOttimizzata) {
                 // LAYOUT OTTIMIZZATO COMPATTO
                 btn.className = "btn-cassa-ottimizzata";
                 btn.innerHTML = ""; // Rimuove il wrapper standard

                 // 🔹 FIX: Normalizziamo la categoria se il piatto è salvato con il nome personalizzato (es: Risto)
                 let ctg = (item.categoria || "cibi").toLowerCase().trim();
                 const lE1 = (window.nomiRepartiExtra?.extra1 || "").toLowerCase().trim();
                 const lE2 = (window.nomiRepartiExtra?.extra2 || "").toLowerCase().trim();
                 const lE3 = (window.nomiRepartiExtra?.extra3 || "").toLowerCase().trim();
                 
                 if (ctg === "extra1" || ctg === "risto" || (lE1 && ctg === lE1)) ctg = "extra1";
                 else if (ctg === "extra2" || (lE2 && ctg === lE2)) ctg = "extra2";
                 else if (ctg === "extra3" || (lE3 && ctg === lE3)) ctg = "extra3";

                 let coloreBase = "#4CAF50"; 
                 if (ctg === "bevande") coloreBase = "#2196F3";
                 else if (ctg === "snack") coloreBase = "#FF5722";
                 else if (ctg === "extra1") coloreBase = "#9C27B0";
                 else if (ctg === "extra2") coloreBase = "#009688";
                 else if (ctg === "extra3") coloreBase = "#795548";

                 btn.style.cssText = `
                     background-color: #f8f9fa !important;
                     color: #333 !important;
                     border: 1px solid #ccc !important;
                     border-left: 4px solid ${coloreBase} !important;
                     padding: 6px 4px;
                     margin: 0;
                     border-radius: 4px;
                     box-shadow: 0 1px 2px rgba(0,0,0,0.05);
                     display: flex;
                     flex-direction: column;
                     justify-content: center;
                     align-items: center;
                     width: 100%;
                     min-height: 40px; /* DIMENSIONE MINIMA TASSATIVA */
                     height: max-content; /* L'ALTEZZA SI BASA SUL TESTO */
                     box-sizing: border-box;
                     overflow: hidden;
                 `;
                 
                 const prezzoScontato = item.sconto ? calcolaPrezzoConSconto(item).toFixed(2) : item.prezzo.toFixed(2);
                 
                 // Rimuovi style="color:#555" da dentro il tag <small>
				btn.innerHTML = `
					<span style="font-weight:bold; font-size:12px; white-space:normal; line-height:1.1; text-align:center;">${item.nome}</span>
					<small style="font-size:11px; font-weight:bold; margin-top:2px;">€${prezzoScontato}</small>
				`;
                 
                 const containerIdMap = {
                     cibi: { id: "menuCibi", nome: "Cibi", enabled: true, color: "#4CAF50" },
                     bevande: { id: "menuBevande", nome: "Bevande", enabled: true, color: "#2196F3" },
                     snack: { id: "menuSnack", nome: "Snack", enabled: window.settings.snackAbilitato, color: "#FF5722" },
                     // 🔹 Mostra SEMPRE gli extra in Cassa se hanno piatti configurati
                     extra1: { id: "menuExtra1", nome: window.nomiRepartiExtra?.extra1 || "Extra 1", enabled: true, color: "#9C27B0" },
                     extra2: { id: "menuExtra2", nome: window.nomiRepartiExtra?.extra2 || "Extra 2", enabled: true, color: "#009688" },
                     extra3: { id: "menuExtra3", nome: window.nomiRepartiExtra?.extra3 || "Extra 3", enabled: true, color: "#795548" }
                 };
                 
                 const conf = containerIdMap[ctg] || containerIdMap["cibi"];
                 if (conf && conf.enabled) {
                      const div = document.getElementById(conf.id);
                      if (div) {
                          if (!div.querySelector("h5")) {
                              div.style.display = "flex";
                              div.style.flexDirection = "column";
                              div.style.height = "max-content"; // IL TRUCCO: altezza limitata ai tasti
                              div.style.boxSizing = "border-box";
                              div.style.background = "#fcfcfc";
                              div.style.border = "1px solid #e0e0e0";
                              div.style.borderRadius = "8px";
                              div.style.padding = "6px";
                              div.style.margin = "0";
                              div.style.overflow = "hidden"; 

                              div.innerHTML = `
                                  <h5 style="margin:0 0 6px 0; color:#333; font-size:0.95em; border-bottom:1px solid #ddd; padding-bottom:4px; display:flex; align-items:center; flex-shrink: 0;">
                                      <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background-color:${conf.color}; margin-right:6px;"></span>
                                      ${conf.nome}
                                  </h5>
                                  <div class="cassa-ottimizzata-container" style="display:grid; grid-template-columns: repeat(2, 1fr); grid-auto-rows: max-content; gap:4px; overflow: hidden;"></div>
                              `;
                          }
                          div.querySelector(".cassa-ottimizzata-container").appendChild(btn);
                      }
                 }
                 
            } else {
                 // LAYOUT STANDARD ESTESO (Ottimizzata OFF)
                 btn.className = "piatto-btn"; 
                 
                 // Ripristiniamo ESATTAMENTE il metodo originale per forzare il grigino
                 btn.style.cssText = "";
                 Object.assign(btn.style, {
                     background: "#f5f5f5",
                     color: "#333",
                     border: "1px solid #aaa"
                 });
                 
                 // 🔹 FIX: Ripetiamo la logica di correzione anche per la visualizzazione a griglia standard
                 let ctgStandard = (item.categoria || "cibi").toLowerCase().trim();
                 const lE1_s = (window.nomiRepartiExtra?.extra1 || "").toLowerCase().trim();
                 const lE2_s = (window.nomiRepartiExtra?.extra2 || "").toLowerCase().trim();
                 const lE3_s = (window.nomiRepartiExtra?.extra3 || "").toLowerCase().trim();
                 
                 if (ctgStandard === "extra1" || ctgStandard === "risto" || (lE1_s && ctgStandard === lE1_s)) ctgStandard = "extra1";
                 else if (ctgStandard === "extra2" || (lE2_s && ctgStandard === lE2_s)) ctgStandard = "extra2";
                 else if (ctgStandard === "extra3" || (lE3_s && ctgStandard === lE3_s)) ctgStandard = "extra3";

                 const gridIdMap = {
                     cibi: "grid-cibi", bevande: "grid-bevande", snack: "grid-snack",
                     extra1: "grid-extra1", extra2: "grid-extra2", extra3: "grid-extra3"
                 };
                 const targetGridId = gridIdMap[ctgStandard] || "grid-cibi";
                 const targetGrid = document.getElementById(targetGridId);
                 if (targetGrid) targetGrid.appendChild(btn);
            }
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

        ingredientiRef.on("value", snap => { 
                window.ingredientData = snap.val() || {}; 
                aggiornaBottoniBloccati(); 
                // FIX: Riattiva l'aggiornamento degli ingredienti critici in tempo reale
                if (typeof aggiornaListaIngredientiCritici === "function") aggiornaListaIngredientiCritici(); 
            });
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
    const ingData = window.ingredientData || {};
    const menuData = window.menuData || {};
    const isOpt = window.settings.cassaOttimizzata; // Determina quale stile applicare

    ["menuCibi", "menuBevande", "menuSnack", "menuExtra1", "menuExtra2", "menuExtra3"].forEach(sezioneId => {
        const container = document.getElementById(sezioneId);
        if (!container) return;

        const bottoni = Array.from(container.querySelectorAll("button"));

        // Ciclo su ogni singolo bottone per verificare se deve essere bloccato
        bottoni.forEach(btn => {
            const menuId = btn.dataset.menuId;
            if (!menuId) return;

            const item = menuData[menuId];
            if (!item) return;

            let disponibile = true;

            // 1. Controllo blocco manuale da Admin
            if (item.bloccato === true) {
                disponibile = false;
            }

            // 2. Controllo disponibilità degli ingredienti associati
            if (disponibile && item.ingredienti) {
                for (const ing of item.ingredienti) {
                    const dbIng = ingData[ing.id];
                    if (dbIng && dbIng.disponibile === false) {
                        disponibile = false;
                        break;
                    }
                }
            }

            // Determina il colore base in caso di Cassa Ottimizzata per i piatti disponibili
            let ctg = (item.categoria || "cibi").toLowerCase().trim();
            let coloreBase = "#4CAF50"; 
            if (ctg === "bevande") coloreBase = "#2196F3";
            else if (ctg === "snack") coloreBase = "#FF5722";
            else if (ctg === "extra1" || ctg === "risto") coloreBase = "#9C27B0";
            else if (ctg === "extra2") coloreBase = "#009688";
            else if (ctg === "extra3") coloreBase = "#795548";
			let repMatch = ctg;
			if (ctg === "cibi") repMatch = "cucina";
			if (ctg === "bevande") repMatch = "bere";
			
			if (window.repartiChiusi && window.repartiChiusi[repMatch] === true) {
			    disponibile = false;
			    // Se vuoi puoi anche cambiare il testo del bottone se è ottimizzata
			    item.bloccatoDaChiusura = true; // Flag temporaneo per lo stile
			} else {
			    item.bloccatoDaChiusura = false;
			}

            // --- APPLICAZIONE STILI VISIVI E BLOCCHI ---
            if (!disponibile) {
                btn.disabled = true; // Impedisce il click
                
                if (item.bloccatoDaChiusura) {
                    // REPARTO CHIUSO -> GRIGIO SCURO/ROSSO
                    if (isOpt) {
                        btn.style.cssText = `background: #eceff1 !important; color: #78909c !important; border: 2px dashed #90a4ae !important; opacity: 0.6 !important; padding: 4px 2px; border-radius: 6px; width: 100%; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; align-items: center; border-left: 5px solid #607d8b !important;`;
                    } else {
                        btn.style.cssText = "";
                        Object.assign(btn.style, { opacity: 0.6, border: "2px dashed #90a4ae", background: "#eceff1", color: "#78909c" });
                    }
                } else if (item.bloccato === true) {
                    // BLOCCO ADMIN MANUALE -> ARANCIONE
                    if (isOpt) {
                        btn.style.cssText = `background: #fff3cd !important; color: #ff9800 !important; border: 2px dashed orange !important; opacity: 0.8 !important; padding: 4px 2px; border-radius: 6px; width: 100%; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; align-items: center; border-left: 5px solid orange !important;`;
                    } else {
                        btn.style.cssText = "";
                        Object.assign(btn.style, { opacity: 0.8, border: "2px dashed orange", background: "#fff3cd", color: "#ff9800" });
                    }
                } else {
                    // INGREDIENTE ESAURITO -> ROSSO
                    if (isOpt) {
                        btn.style.cssText = `background: #f8d7da !important; color: #d9534f !important; border: 2px dashed #d9534f !important; opacity: 0.6 !important; padding: 4px 2px; border-radius: 6px; width: 100%; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; align-items: center; border-left: 5px solid #d9534f !important;`;
                    } else {
                        btn.style.cssText = "";
                        Object.assign(btn.style, { opacity: 0.6, border: "2px solid #d9534f", background: "#f8d7da", color: "#d9534f" });
                    }
                }
            } else {
                btn.disabled = false; // Sblocca il click
                
                if (isOpt) {
                    // Ottimizzata Standard: Grigino pulito con lato colorato
                    btn.style.cssText = `background: #f8f9fa !important; color: #333 !important; border: 1px solid #ccc !important; border-left: 5px solid ${coloreBase} !important; padding: 4px 2px; margin: 0; border-radius: 6px; width: 100%; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; align-items: center; overflow: hidden;`;
                } else {
                    // Cassa Estesa Standard: Grigio Classico
                    btn.style.cssText = ""; 
                    Object.assign(btn.style, { opacity: 1, border: "1px solid #aaa", background: "#f5f5f5", color: "#333" });
                }
            }
        });
    });
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
    // --- INIZIO MATEMATICA SCONTO GLOBALE ---
    if (window.scontiGlobaliAbilitati && window.scontoGlobaleCorrente) {
        const g = window.scontoGlobaleCorrente;
        let importoSconto = 0;

        if (g.tipo === "gratis") {
            importoSconto = tot;
            tot = 0; // Azzera tutto
        } else if (g.tipo === "percentuale") {
            importoSconto = (tot * g.valore / 100);
            tot = tot - importoSconto;
        } else if (g.tipo === "fisso") {
            importoSconto = g.valore;
            tot = tot - importoSconto;
        }
        
        // Il totale non può essere negativo
        if (tot < 0) tot = 0;

        // Inietta la riga visiva in fondo al carrello
        const divSconto = document.createElement("div");
        divSconto.style.display = "flex";
        divSconto.style.justifyContent = "space-between";
        divSconto.style.alignItems = "center";
        divSconto.style.marginTop = "8px";
        divSconto.style.paddingTop = "8px";
        divSconto.style.borderTop = "1px dashed #ccc";
        
        const spanSconto = document.createElement("span");
        spanSconto.style.flex = "1";
        spanSconto.innerHTML = `<b style="color:#e65100;">🎟️ Sconto: ${g.nome}</b> <span style="color:red; margin-left: 5px;">-€${importoSconto.toFixed(2)}</span>`;
        
        const controls = document.createElement("span");
        const btnDeleteSconto = document.createElement("button");
        btnDeleteSconto.innerText = "X";
        btnDeleteSconto.style.marginLeft = "6px";
        btnDeleteSconto.style.color = "#000000";
        btnDeleteSconto.style.fontWeight = "900";
        btnDeleteSconto.style.backgroundColor = "#ffcccc";
        btnDeleteSconto.onclick = () => window.rimuoviScontoGlobaleCassa();
        
        controls.appendChild(btnDeleteSconto);
        divSconto.appendChild(spanSconto);
        divSconto.appendChild(controls);
        
        div.appendChild(divSconto); // Aggiunge al contenitore del carrello
    }
    // --- FINE MATEMATICA SCONTO GLOBALE ---

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
        
        // FIX: Recuperiamo i costi dei contorni e li sommiamo all'extra del piatto
        let costoContorni = 0;
        if (piatto.contorniScelti && piatto.contorniScelti.length > 0) {
            piatto.contorniScelti.forEach(c => {
                costoContorni += (c.prezzoPagato || 0) + (c.extraPrezzo || 0);
            });
        }
        piatto.extraPrezzo = tempExtraPrezzo + costoContorni;
        
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
    const num = numInput ? numInput.value.trim() : "";
    const lettera = letteraInput ? letteraInput.value.trim().toUpperCase() : "";

    // verifica che ci sia almeno un piatto con quantità > 0
    const hasPiattiValidi = comandaCorrente.some(p => p.quantita > 0);

    // Se il sistema progressivo è attivo, non serve controllare che 'num' sia compilato
    const numOk = window.settings.comandeProgressive ? true : !!num;

    // Se la lettera è disabilitata nelle impostazioni, saltiamo il controllo
    const letteraOk = window.settings.letteraComandaAbilitata ? (lettera && /^[A-Z]$/.test(lettera)) : true;

    // Controllo tavolo obbligatorio (salvo asporto)
    let tavoloOk = true; // Iniziamo presupponendo che vada bene
    if (window.settings.richiediTavolo) {
        const checkAsporto = document.getElementById("checkAsporto");
        const inputTavolo = document.getElementById("numeroTavoloCassa");
        
        // Verifica se l'asporto è attivo e spuntato
        const isAsporto = window.settings.asportoAbilitato && checkAsporto && checkAsporto.checked;

        // Se NON è asporto, e il campo esiste...
        if (!isAsporto && inputTavolo) {
            // Controlla se il campo ha un valore valido
            const numeroTavoloVal = inputTavolo.value.trim();
            if (!numeroTavoloVal) {
                 tavoloOk = false; // Se è vuoto, tavolo NON va bene
            }
        }
    }

    // disabilita se manca numero, lettera (se abilitata), piatti o tavolo
    inviaBtn.disabled = !(numOk && letteraOk && hasPiattiValidi && tavoloOk);

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
if (numInput) numInput.addEventListener("input", aggiornaStatoInvio);
if (letteraInput) letteraInput.addEventListener("input", aggiornaStatoInvio);

const inputQuantita = document.getElementById("quantita");
if (inputQuantita) inputQuantita.addEventListener("change", aggiornaStatoInvio);

// ---> INIZIO GESTIONE DISABILITAZIONE TAVOLO PER ASPORTO E RE-CHECK <---
const checkAsportoCassa = document.getElementById("checkAsporto");
if (checkAsportoCassa) {
    checkAsportoCassa.addEventListener("change", (e) => {
        const inputTavolo = document.getElementById("numeroTavoloCassa");
        if (inputTavolo) {
            if (e.target.checked) {
                inputTavolo.disabled = true;
                inputTavolo.style.backgroundColor = "#e0e0e0";
                inputTavolo.value = ""; // Svuota il tavolo se asporto
            } else {
                inputTavolo.disabled = false;
                inputTavolo.style.backgroundColor = "#fff";
            }
        }
        // Quando spunto o tolgo l'asporto, ricontrolla lo stato del bottone invia
        aggiornaStatoInvio(); 
    });
}

// Quando digito un numero nel tavolo, aggiorna lo stato del bottone invia
const inputTavoloCassa = document.getElementById("numeroTavoloCassa");
if (inputTavoloCassa) {
    inputTavoloCassa.addEventListener("input", aggiornaStatoInvio);
}
// ---> FINE GESTIONE DISABILITAZIONE TAVOLO PER ASPORTO E RE-CHECK <---
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
        listaDiv.innerHTML = "<p>Nessun contorno disponibile al momento. Mangerai il piatto da solo... 😢</p>";
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
                // --- LEGGI LA QUANTITÀ DEL SELETTORE CASSA PER IL PIATTO PRINCIPALE ---
                let qtyPrincipale = 1;
                if (window.settings.selettoreQuantitaCassa) {
                    const quantVal = document.getElementById("quantita").value;
                    qtyPrincipale = parseInt(quantVal);
                    if (!qtyPrincipale || qtyPrincipale <= 0) qtyPrincipale = 1; // Sicurezza fallback
                }
                
                // Raggruppa nel carrello se è identico!
                let comboEsistente = comandaCorrente.find(x => 
                    x.nome === piattoCombo.nome && 
                    JSON.stringify(x.contorniScelti || []) === JSON.stringify(contorniDaSalvare) && 
                    (!x.varianti || x.varianti.length === 0)
                );

                if (comboEsistente) {
                    comboEsistente.quantita += qtyPrincipale; // Usa la quantità invece di +1
                } else {
                    comandaCorrente.push({
                        nome: piattoCombo.nome, 
                        prezzo: piattoCombo.prezzo, 
                        categoria: piattoCombo.categoria,
                        ingredienti: piattoCombo.ingredienti ? JSON.parse(JSON.stringify(piattoCombo.ingredienti)) : [],
                        varianti: [], 
                        extraPrezzo: totaleExtra, 
                        quantita: qtyPrincipale,  // Usa la quantità invece di 1
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
    aggiornaTempoMedioCassa(snap.val() || {});
    const ordiniIds = new Set();

    // Se non ci sono comande
    if (!snap.exists()) {
      div.innerHTML = "<i>Gli chef si stanno girando i pollici... Dacci dentro con gli ordini! 👨‍🍳😴</i>";
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
          // --- MAGIA PER PIATTO PRINCIPALE ---
          let nomePulito = i.nome || "";
          let varTxt = "";
          let variantiArray = i.varianti ? (Array.isArray(i.varianti) ? i.varianti : Object.values(i.varianti)) : [];
          
          const regex = /\s*\(([\+\-].*?)\)/;
          const matchMain = nomePulito.match(regex);
          
          if (matchMain) {
              nomePulito = nomePulito.replace(regex, "").trim();
              if (variantiArray.length === 0) {
                  let estratti = matchMain[1].split(",");
                  estratti.forEach(ex => {
                      ex = ex.trim();
                      if (ex.startsWith("+")) variantiArray.push({ tipo: "aggiunta", nome: ex.substring(1).trim() });
                      else if (ex.startsWith("-")) {
                          let n = ex.substring(1).trim();
                          if (n.toLowerCase().startsWith("senza ")) n = n.substring(6).trim();
                          variantiArray.push({ tipo: "rimozione", nome: n });
                      }
                  });
              }
          }

          if (variantiArray.length > 0) {
              let conteggio = {};
              variantiArray.forEach(v => {
                  if (!v || !v.tipo) return;
                  let key = v.tipo + "_" + v.nome;
                  if (!conteggio[key]) conteggio[key] = { tipo: v.tipo, nome: v.nome, count: 0 };
                  conteggio[key].count++;
              });

              let txt = Object.values(conteggio).map(v => {
                  let nomeExtra = v.nome.charAt(0).toUpperCase() + v.nome.slice(1);
                  let qTxt = v.count > 1 ? `${v.count}x ` : "";
                  if (v.tipo === "aggiunta") return `<span style="color:green; font-weight:bold;">+ ${qTxt}${nomeExtra}</span>`;
                  else return `<span style="color:red; font-weight:bold;">- Senza ${nomeExtra}</span>`;
              }).join(", ");
              varTxt = ` <span style="font-size:0.85em;">(${txt})</span>`;
          }

          let base = "";
          if (i.isMainHere !== false) {
              base = `${i.quantita}x ${nomePulito}${varTxt}`;
          } else {
              base = `<span style="font-style:italic; color:#777;">[Di: ${i.quantita}x ${nomePulito}]</span>`;
          }

          // --- MAGIA PER CONTORNI ---
          if (i.contorniScelti && i.contorniScelti.length > 0) {
              let contorniHtml = i.contorniScelti.map(c => {
                  let cNome = c.nome || "";
                  let cVarTxt = "";
                  let cVarArray = c.varianti ? (Array.isArray(c.varianti) ? c.varianti : Object.values(c.varianti)) : [];
                  
                  const matchCont = cNome.match(regex);
                  if (matchCont) {
                      cNome = cNome.replace(regex, "").trim();
                      if (cVarArray.length === 0) {
                          let estratti = matchCont[1].split(",");
                          estratti.forEach(ex => {
                              ex = ex.trim();
                              if (ex.startsWith("+")) cVarArray.push({ tipo: "aggiunta", nome: ex.substring(1).trim() });
                              else if (ex.startsWith("-")) {
                                  let n = ex.substring(1).trim();
                                  if (n.toLowerCase().startsWith("senza ")) n = n.substring(6).trim();
                                  cVarArray.push({ tipo: "rimozione", nome: n });
                              }
                          });
                      }
                  }

                  if (cVarArray.length > 0) {
                      let conteggioC = {};
                      cVarArray.forEach(v => {
                          if (!v || !v.tipo) return;
                          let key = v.tipo + "_" + v.nome;
                          if (!conteggioC[key]) conteggioC[key] = { tipo: v.tipo, nome: v.nome, count: 0 };
                          conteggioC[key].count++;
                      });
                      let txtC = Object.values(conteggioC).map(v => {
                          let nomeExtra = v.nome.charAt(0).toUpperCase() + v.nome.slice(1);
                          let qTxt = v.count > 1 ? `${v.count}x ` : "";
                          if (v.tipo === "aggiunta") return `<span style="color:green; font-weight:bold;">+ ${qTxt}${nomeExtra}</span>`;
                          else return `<span style="color:red; font-weight:bold;">- Senza ${nomeExtra}</span>`;
                      }).join(", ");
                      cVarTxt = ` <span style="font-size:0.85em;">(${txtC})</span>`;
                  }

                  return `↳ ${i.quantita}x ${cNome}${cVarTxt}`;
              }).join("<br>");
              
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
            d = document.createElement("div");
            d.id = "cassa_comanda_" + id;
            d.className = "order";
            d.dataset.numero = (c.numero + (c.lettera || "")).toUpperCase();
            d.dataset.tavolo = c.tavolo ? c.tavolo.toString().toLowerCase() : "";
            d.dataset.orario = c.orario || "";
            d.dataset.prodotti = (c.piatti || []).map(p => p.nome).join(" ").toLowerCase();
            div.prepend(d);
        } else {
            d.dataset.numero = (c.numero + (c.lettera || "")).toUpperCase();
            d.dataset.tavolo = c.tavolo ? c.tavolo.toString().toLowerCase() : "";
            d.dataset.orario = c.orario || "";
            d.dataset.prodotti = (c.piatti || []).map(p => p.nome).join(" ").toLowerCase();
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
    
    // 🔹 FIX SFARFALLIO: Mostriamo "Caricamento" SOLO se la lista è totalmente vuota
    if (container.innerHTML.trim() === "") {
        container.innerHTML = "Caricamento ingredienti...";
    }

    try {
        const snap = await db.ref("ingredienti").once("value");
        const data = snap.val() || {};
        
        // 🔥 FIX PRESTAZIONI: Leggiamo il menu UNA SOLA VOLTA, fuori dal ciclo degli ingredienti!
        const snapMenu = await db.ref("menu").once("value");
        const menuData = snapMenu.val() || {};

        // 🔹 Controllo automatico: blocca/sblocca piatti in base agli ingredienti
        for (const ingId in data) {
            const ing = data[ingId];
            if (!ing) continue;

            // Controlla se l'ingrediente è finito
            const finito = (ing.disponibile === false || (ing.rimanente !== null && ing.rimanente !== undefined && ing.rimanente <= 0));

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
        
        const fragment = document.createDocumentFragment();

        if (Object.keys(data).length === 0) {
            const divVuoto = document.createElement("div");
            divVuoto.innerHTML = "<i>La dispensa rimbomba... Vai a fare la spesa e aggiungi qualche ingrediente! 🛒🍅</i>";
            fragment.appendChild(divVuoto);
        } else {
            const categorie = {};

            // Raggruppa per categoria
            for (const [id, ing] of Object.entries(data)) {
                const cat = ing.categoria || "Altro";
                if (!categorie[cat]) categorie[cat] = [];
                categorie[cat].push({ id, ...ing });
            }

            for (const [cat, items] of Object.entries(categorie)) {
                // 🔹 SE IL PROFILO E' SPENTO E NON HA PIATTI, NASCONDILO
                let abilita = true;
                if (cat === "snack") abilita = window.settings.snackAbilitato;
                if (cat.startsWith("extra")) abilita = window.settings[cat + "Abilitato"];
                
                if (!abilita && !window.categoriaHaPiatti(cat)) continue;

                const catDiv = document.createElement("div");
                const h3 = document.createElement("h3");
                
                // Mettiamo il nome personalizzato
                let catTitle = cat.charAt(0).toUpperCase() + cat.slice(1);
                if (cat === "extra1") catTitle = window.nomiRepartiExtra?.extra1 || "Extra 1";
                if (cat === "extra2") catTitle = window.nomiRepartiExtra?.extra2 || "Extra 2";
                if (cat === "extra3") catTitle = window.nomiRepartiExtra?.extra3 || "Extra 3";

                h3.innerText = catTitle;
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
                        disonotify(`Eliminare definitivamente "${ing.nome}"?`, {
                            confirmText: "Elimina",
                            showCancel: true,
                            cancelText: "Annulla",
                            onConfirm: async () => {
                                await db.ref(`ingredienti/${ing.id}`).remove();
                                const snapMenu2 = await db.ref("menu").once("value");
                                const menuData2 = snapMenu2.val() || {};
                                for (const [pid, piatto] of Object.entries(menuData2)) {
                                    if (piatto.ingredienti) {
                                        const nuoviIng = piatto.ingredienti.filter(x => x.id !== ing.id);
                                        if (nuoviIng.length !== piatto.ingredienti.length) {
                                            await db.ref(`menu/${pid}/ingredienti`).set(nuoviIng);
                                        }
                                    }
                                }
                                await caricaIngredienti();
                                notify("Ingrediente eliminato.", "info");
                            }
                        });
                    };

                  const btnExtra = document.createElement("button");
                    btnExtra.innerText = "✏️ Modifica";
                    btnExtra.title = "Modifica dettagli ingrediente, soglie e aggiunte";
                    btnExtra.style.marginLeft = "5px";
                    btnExtra.onclick = () => {
                        const currentIng = window.ingredientData[ing.id] || ing;

                        const defP = currentIng.prezzoExtra !== undefined ? currentIng.prezzoExtra : 0.50;
                        const defQ = currentIng.qtyExtra !== undefined ? currentIng.qtyExtra : 1;
                        
                        // Soglie
                        const valAtt = (currentIng.sogliaAttenzione !== undefined && currentIng.sogliaAttenzione !== null) ? currentIng.sogliaAttenzione : "";
                        const valCrit = (currentIng.sogliaCritica !== undefined && currentIng.sogliaCritica !== null) ? currentIng.sogliaCritica : "";

                        const cats = currentIng.categorieApplicabili || [currentIng.categoria || "cibi"];
                        const isCibi = cats.includes("cibi") ? "checked" : "";
                        const isBevande = cats.includes("bevande") ? "checked" : "";
                        const isSnack = cats.includes("snack") ? "checked" : "";
                        const isExtra1 = cats.includes("extra1") ? "checked" : "";
                        const isExtra2 = cats.includes("extra2") ? "checked" : "";
                        const isExtra3 = cats.includes("extra3") ? "checked" : "";
                        
                        const isExtraChecked = currentIng.usabileComeExtra ? "checked" : "";

                        const overlay = document.createElement("div");
                        overlay.className = "modal-overlay";
                        overlay.style.zIndex = "10005";
                        
                        const nE1 = window.nomiRepartiExtra?.extra1 || "Extra 1";
                        const nE2 = window.nomiRepartiExtra?.extra2 || "Extra 2";
                        const nE3 = window.nomiRepartiExtra?.extra3 || "Extra 3";

                        const modal = document.createElement("div");
                        const displayImpostazioni = currentIng.usabileComeExtra ? "block" : "none";

                        modal.className = "modal-varianti";
                        modal.innerHTML = `
                            <h3 style="margin-bottom: 20px;">Modifica: ${currentIng.nome}</h3>
                            
                            <div style="margin-bottom:15px; text-align:left;">
                                <label><b>Nome Ingrediente:</b></label>
                                <input type="text" id="modIngNomeEdit" value="${currentIng.nome.replace(/"/g, '&quot;')}" style="width:100%; box-sizing:border-box; padding:8px; margin-top:5px; border-radius:6px; border:1px solid #ccc;">
                            </div>

                            <div style="margin-bottom:15px; text-align:left; display:flex; gap:10px;">
                                <div style="flex:1;">
                                    <label><b>Categoria:</b></label>
                                    <select id="modIngCatEdit" style="width:100%; padding:8px; margin-top:5px; border-radius:6px; border:1px solid #ccc;">
                                        <option value="cibi" ${currentIng.categoria === 'cibi' ? 'selected' : ''}>Cibi</option>
                                        <option value="bevande" ${currentIng.categoria === 'bevande' ? 'selected' : ''}>Bevande</option>
                                        <option value="snack" ${currentIng.categoria === 'snack' ? 'selected' : ''}>Snack</option>
                                        ${window.settings.extra1Abilitato ? `<option value="extra1" ${currentIng.categoria === 'extra1' ? 'selected' : ''}>${nE1}</option>` : ''}
                                        ${window.settings.extra2Abilitato ? `<option value="extra2" ${currentIng.categoria === 'extra2' ? 'selected' : ''}>${nE2}</option>` : ''}
                                        ${window.settings.extra3Abilitato ? `<option value="extra3" ${currentIng.categoria === 'extra3' ? 'selected' : ''}>${nE3}</option>` : ''}
                                    </select>
                                </div>
                                <div style="flex:1;">
                                    <label><b>Unità di misura:</b></label>
                                    <select id="modIngUnitaEdit" style="width:100%; padding:8px; margin-top:5px; border-radius:6px; border:1px solid #ccc;">
                                        <option value="" ${!currentIng.unita ? 'selected' : ''}>Nessuna</option>
                                        <option value="kg" ${currentIng.unita === 'kg' ? 'selected' : ''}>kg</option>
                                        <option value="g" ${currentIng.unita === 'g' ? 'selected' : ''}>g</option>
                                        <option value="l" ${currentIng.unita === 'l' ? 'selected' : ''}>l</option>
                                        <option value="ml" ${currentIng.unita === 'ml' ? 'selected' : ''}>ml</option>
                                        <option value="pz" ${currentIng.unita === 'pz' ? 'selected' : ''}>pz</option>
                                        <option value="Lattina 33cl" ${currentIng.unita === 'Lattina 33cl' ? 'selected' : ''}>Lattina 33cl</option>
                                    </select>
                                </div>
                            </div>

                            <hr style="margin: 15px 0; border: 0; border-top: 1px solid #ddd;">

                            <div style="margin-bottom:15px; text-align:left; display:flex; gap:10px; padding: 10px; border: 1px solid #ccc; border-radius: 6px; background: #fafafa;" class="box-soglie-admin">
                                <div style="flex:1;">
                                    <label><b>⚠️ Soglia Attenzione:</b></label>
                                    <input type="number" step="0.1" id="valSogliaAtt" value="${valAtt}" placeholder="Auto" style="width:100%; box-sizing:border-box; padding:8px; margin-top:5px; border-radius:6px; border: 1px solid #ccc;">
                                </div>
                                <div style="flex:1;">
                                    <label><b>🚨 Soglia Critica:</b></label>
                                    <input type="number" step="0.1" id="valSogliaCrit" value="${valCrit}" placeholder="Auto" style="width:100%; box-sizing:border-box; padding:8px; margin-top:5px; border-radius:6px; border: 1px solid #ccc;">
                                </div>
                            </div>
                            
                            <div style="margin-bottom:15px; text-align:left; background: #e8f5e9; padding: 10px; border-radius: 6px; border: 1px solid #c8e6c9;" class="box-usabile-extra">
                                <label style="cursor:pointer; display:flex; align-items:center;">
                                    <input type="checkbox" id="chkUsabileExtra" ${isExtraChecked} style="transform: scale(1.2); margin-right: 8px;" onchange="document.getElementById('bloccoImpostazioniExtra').style.display = this.checked ? 'block' : 'none';"> 
                                    <b>Utilizzabile come variante / aggiunta nei piatti</b>
                                </label>
                            </div>

                            <div id="bloccoImpostazioniExtra" style="display: ${displayImpostazioni};">
                                <div style="margin-bottom:15px; text-align:left;">
                                    <label><b>Prezzo Extra (€):</b></label>
                                    <input type="number" step="0.01" id="valPrezzo" value="${defP}" style="width:100%; box-sizing:border-box; padding:8px; margin-top:5px; border-radius:6px; border: 1px solid #ccc;">
                                </div>
                                
                                <div style="margin-bottom:15px; text-align:left;">
                                    <label><b>Quantità scalata dal magazzino:</b></label>
                                    <input type="number" step="0.1" id="valQty" value="${defQ}" style="width:100%; box-sizing:border-box; padding:8px; margin-top:5px; border-radius:6px; border: 1px solid #ccc;">
                                </div>
                                
                                <div style="margin-bottom:20px; text-align:left;">
                                    <label><b>Mostra come variante per i piatti in:</b></label><br>
                                    <div style="margin-top:8px;">
                                        <label style="margin-right:15px;"><input type="checkbox" class="chk-cat" value="cibi" ${isCibi}> Cibi</label>
                                        <label style="margin-right:15px;"><input type="checkbox" class="chk-cat" value="bevande" ${isBevande}> Bevande</label>
                                        <label style="margin-right:15px;"><input type="checkbox" class="chk-cat" value="snack" ${isSnack}> Snack</label>
                                        ${window.settings.extra1Abilitato ? `<label style="margin-right:15px;"><input type="checkbox" class="chk-cat" value="extra1" ${isExtra1}> ${nE1}</label>` : ''}
                                        ${window.settings.extra2Abilitato ? `<label style="margin-right:15px;"><input type="checkbox" class="chk-cat" value="extra2" ${isExtra2}> ${nE2}</label>` : ''}
                                        ${window.settings.extra3Abilitato ? `<label><input type="checkbox" class="chk-cat" value="extra3" ${isExtra3}> ${nE3}</label>` : ''}
                                    </div>
                                </div>
                            </div>
                            
                            <div class="modal-actions">
                                <button class="btn-chiudi" id="closeModal">Annulla</button>
                                <button class="btn-salva" id="saveModal">Salva Modifiche</button>
                            </div>
                        `;
                        
                        overlay.appendChild(modal);
                        document.body.appendChild(overlay);

                        document.getElementById("closeModal").onclick = () => overlay.remove();
                        
                        document.getElementById("saveModal").onclick = async () => {
                            const nuovoNome = document.getElementById("modIngNomeEdit").value.trim();
                            const nuovaCat = document.getElementById("modIngCatEdit").value;
                            const nuovaUnita = document.getElementById("modIngUnitaEdit").value;
                            
                            if (!nuovoNome) {
                                if (typeof notify === "function") notify("Il nome dell'ingrediente è obbligatorio!", "warn");
                                return;
                            }

                            const p = parseFloat(document.getElementById("valPrezzo").value);
                            const q = parseFloat(document.getElementById("valQty").value);
                            const usabile = document.getElementById("chkUsabileExtra").checked;
                            
                            const sAtt = document.getElementById("valSogliaAtt").value;
                            const sCrit = document.getElementById("valSogliaCrit").value;
                            
                            const selectedCats = [];
                            document.querySelectorAll(".chk-cat:checked").forEach(cb => selectedCats.push(cb.value));

                            // 1. Aggiorna i dati nel nodo "ingredienti"
                            await db.ref(`ingredienti/${ing.id}`).update({ 
                                nome: nuovoNome,
                                categoria: nuovaCat,
                                unita: nuovaUnita,
                                prezzoExtra: isNaN(p) ? 0 : p, 
                                qtyExtra: isNaN(q) ? 1 : q,
                                categorieApplicabili: selectedCats,
                                usabileComeExtra: usabile,
                                sogliaAttenzione: sAtt === "" ? null : parseFloat(sAtt),
                                sogliaCritica: sCrit === "" ? null : parseFloat(sCrit)
                            });

                            // 2. Aggiorna a cascata il nome e l'unità di misura all'interno dei piatti del Menù
                            try {
                                const snapMenu = await db.ref("menu").once("value");
                                const menuData = snapMenu.val() || {};
                                let updates = {};
                                
                                for (const pid in menuData) {
                                    if (menuData[pid].ingredienti) {
                                        let changed = false;
                                        let nuoviIng = menuData[pid].ingredienti.map(i => {
                                            if (i.id === ing.id && (i.nome !== nuovoNome || i.unita !== nuovaUnita)) {
                                                changed = true;
                                                return { ...i, nome: nuovoNome, unita: nuovaUnita };
                                            }
                                            return i;
                                        });
                                        if (changed) {
                                            updates[`menu/${pid}/ingredienti`] = nuoviIng;
                                        }
                                    }
                                }
                                if (Object.keys(updates).length > 0) {
                                    await db.ref().update(updates);
                                }
                            } catch (err) {
                                console.error("Errore aggiornamento menu a cascata:", err);
                            }

                            overlay.remove();
                            notify("Modifiche salvate!", "success");
                        };
                    };
                    
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
                    
                    const selectUnita = document.createElement("select");
                    ["pz", "kg", "g", "l", "ml", "Lattina 33cl"].forEach(u => {
                        const opt = document.createElement("option");
                        opt.value = u;
                        opt.innerText = u;
                        if(ing.unita === u) opt.selected = true;
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
        }

        // 🔹 FIX SFARFALLIO: Sostituiamo il DOM in un colpo solo, alla fine!
        container.innerHTML = "";
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
    
    // 🔹 RIMOSSO IL FILTRO: Ora mostra tutto il magazzino globale!
    const items = Object.keys(window.ingredientData || {})
        .map(k => ({ id: k, ...window.ingredientData[k] }));

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
        
        // 🔹 AGGIUNTA CATEGORIA: Mostra da quale reparto viene l'ingrediente per evitare confusione
        const nomeCat = it.categoria ? it.categoria.charAt(0).toUpperCase() + it.categoria.slice(1) : "Cibi";
        label.innerHTML = `<b>${it.nome}</b> <small style="color:#888;">[${nomeCat}]</small> <span style="font-size:0.9em;">(${rText !== "illimitato" ? rText + " " + unitaTxt : "illimitato"}) ${it.disponibile === false ? '(esaurito)' : ''}</span>`;


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
	// Genera stringhe HTML dinamiche per le categorie EXTRA
    const nE1 = window.nomiRepartiExtra?.extra1 || "Extra 1";
    const nE2 = window.nomiRepartiExtra?.extra2 || "Extra 2";
    const nE3 = window.nomiRepartiExtra?.extra3 || "Extra 3";

    const optExtra1 = window.settings.extra1Abilitato ? `<option value="extra1">${nE1}</option>` : '';
    const optExtra2 = window.settings.extra2Abilitato ? `<option value="extra2">${nE2}</option>` : '';
    const optExtra3 = window.settings.extra3Abilitato ? `<option value="extra3">${nE3}</option>` : '';

    const chkExtra1 = window.settings.extra1Abilitato ? `<label style="margin-right:15px;"><input type="checkbox" class="mod-chk-cat" value="extra1"> ${nE1}</label>` : '';
    const chkExtra2 = window.settings.extra2Abilitato ? `<label style="margin-right:15px;"><input type="checkbox" class="mod-chk-cat" value="extra2"> ${nE2}</label>` : '';
    const chkExtra3 = window.settings.extra3Abilitato ? `<label><input type="checkbox" class="mod-chk-cat" value="extra3"> ${nE3}</label>` : '';
    
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
                    ${optExtra1} ${optExtra2} ${optExtra3}
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

        <div style="margin-bottom:15px; text-align:left; display:flex; gap:10px; padding: 10px; border: 1px solid #ccc; border-radius: 6px; background: #fafafa;" class="box-soglie-admin">
            <div style="flex:1;">
                <label><b>⚠️ Soglia Attenzione:</b></label>
                <input type="number" step="0.1" id="modIngSogliaAtt" placeholder="Auto" style="width:100%; box-sizing:border-box; padding:8px; margin-top:5px; border-radius:6px; border:1px solid #ccc;">
            </div>
            <div style="flex:1;">
                <label><b>🚨 Soglia Critica:</b></label>
                <input type="number" step="0.1" id="modIngSogliaCrit" placeholder="Auto" style="width:100%; box-sizing:border-box; padding:8px; margin-top:5px; border-radius:6px; border:1px solid #ccc;">
            </div>
        </div>

        <hr style="margin: 15px 0; border: 0; border-top: 1px solid #ddd;">

        <div style="margin-bottom:15px; text-align:left; background: #e8f5e9; padding: 10px; border-radius: 6px; border: 1px solid #c8e6c9;" class="box-usabile-extra">
            <label style="cursor:pointer; display:flex; align-items:center;">
                <input type="checkbox" id="modIngExtra" style="transform: scale(1.2); margin-right: 10px;"> 
                <b>Utilizzabile come variante / aggiunta</b>
            </label>
        </div>

        <div id="impostazioniVarianteContainer" style="display: none;">
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
                    <label style="margin-right:15px;"><input type="checkbox" class="mod-chk-cat" value="snack"> Snack</label>
                    ${chkExtra1} ${chkExtra2} ${chkExtra3}
                </div>
            </div>
        </div>
        <div class="modal-actions" style="display:flex; justify-content:flex-end; gap:10px;">
            <button class="btn-chiudi" id="closeCreaIng">Annulla</button>
            <button class="btn-salva" id="saveCreaIng">Crea Ingrediente</button>
        </div>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Gestione della visibilità dinamica
    const chkExtra = document.getElementById("modIngExtra");
    const impostazioniContainer = document.getElementById("impostazioniVarianteContainer");
    
    chkExtra.addEventListener("change", function() {
        if (this.checked) {
            impostazioniContainer.style.display = "block";
        } else {
            impostazioniContainer.style.display = "none";
        }
    });

    document.getElementById("closeCreaIng").onclick = () => overlay.remove();
    
    document.getElementById("saveCreaIng").onclick = () => {
        const nome = document.getElementById("modIngNome").value.trim();
        const categoria = document.getElementById("modIngCat").value;
        const unita = document.getElementById("modIngUnita").value;
        
        const usabileComeExtra = document.getElementById("modIngExtra").checked;
        const prezzoExtra = parseFloat(document.getElementById("modIngPrezzoExtra").value) || 0;
        const qtyExtra = parseFloat(document.getElementById("modIngQtyExtra").value) || 1;
        
        const sAtt = document.getElementById("modIngSogliaAtt").value;
        const sCrit = document.getElementById("modIngSogliaCrit").value;
        
        const selectedCats = [];
        document.querySelectorAll(".mod-chk-cat:checked").forEach(cb => selectedCats.push(cb.value));
        
        if (!nome) {
            if (typeof notify === "function") notify("Devi inserire il nome dell'ingrediente!", "warning");
            else alert("Devi inserire il nome dell'ingrediente!");
            return;
        }

        // Salvataggio nel Database (Firebase)
        const nuovoRef = db.ref("ingredienti").push();
        nuovoRef.set({
            id: nuovoRef.key,
            nome: nome,
            categoria: categoria,
            unita: unita,
            disponibile: true,
            usabileComeExtra: usabileComeExtra,
            prezzoExtra: prezzoExtra,
            qtyExtra: qtyExtra,
            categorieApplicabili: selectedCats.length > 0 ? selectedCats : [categoria],
            sogliaAttenzione: sAtt === "" ? null : parseFloat(sAtt),
            sogliaCritica: sCrit === "" ? null : parseFloat(sCrit)
        }).then(() => {
            overlay.remove();
            if (typeof notify === "function") notify("Ingrediente creato con successo!", "success");
            
            // 🔹 FIX: Ricarica l'interfaccia istantaneamente appena Firebase dà l'ok!
            if (typeof caricaIngredienti === "function") caricaIngredienti();
            
        }).catch(err => {
            console.error("Errore salvataggio ingrediente:", err);
            if (typeof notify === "function") notify("Errore durante il salvataggio.", "error");
            else alert("Errore durante il salvataggio.");
        });
    };
};
// ==========================================
// RICERCA AVANZATA UNIVERSALE
// ==========================================
function applicaFiltriAvanzati(prefix, containerId) {
    // Leggo i valori usando il prefisso (es. "Admin", "Cassa", "Cucina")
    const numFiltro = document.getElementById(`cercaNumero${prefix}`)?.value.toLowerCase().trim() || "";
    const tavFiltro = document.getElementById(`cercaTavolo${prefix}`)?.value.toLowerCase().trim() || "";
    const prodFiltro = document.getElementById(`cercaProdotto${prefix}`)?.value.toLowerCase().trim() || "";
    const orarioDa = document.getElementById(`cercaOrarioDa${prefix}`)?.value || "";
    const orarioA = document.getElementById(`cercaOrarioA${prefix}`)?.value || "";

    // Trovo tutte le comande dentro il contenitore specifico
    const ordini = document.querySelectorAll(`#${containerId} .order`);

    ordini.forEach(ordine => {
        let mostra = true;
        
        if (numFiltro && !ordine.dataset.numero?.toLowerCase().includes(numFiltro)) mostra = false;
        if (tavFiltro && !ordine.dataset.tavolo?.includes(tavFiltro)) mostra = false;
        if (prodFiltro && !ordine.dataset.prodotti?.includes(prodFiltro)) mostra = false;
        
        if (orarioDa || orarioA) {
            const orarioOrdine = ordine.dataset.orario;
            if (orarioOrdine) {
                if (orarioDa && orarioOrdine < orarioDa) mostra = false;
                if (orarioA && orarioOrdine > orarioA) mostra = false;
            } else {
                mostra = false; 
            }
        }
        
        ordine.style.display = mostra ? "block" : "none";
    });
}

function pulisciFiltri(prefix, containerId) {
    if(document.getElementById(`cercaNumero${prefix}`)) document.getElementById(`cercaNumero${prefix}`).value = "";
    if(document.getElementById(`cercaTavolo${prefix}`)) document.getElementById(`cercaTavolo${prefix}`).value = "";
    if(document.getElementById(`cercaProdotto${prefix}`)) document.getElementById(`cercaProdotto${prefix}`).value = "";
    if(document.getElementById(`cercaOrarioDa${prefix}`)) document.getElementById(`cercaOrarioDa${prefix}`).value = "";
    if(document.getElementById(`cercaOrarioA${prefix}`)) document.getElementById(`cercaOrarioA${prefix}`).value = "";
    
    applicaFiltriAvanzati(prefix, containerId);
}
// GESTIONE comande admin
async function caricaGestioneComandeAdmin() {
    if (!checkOnline(true)) return;
	if (!firebase.auth().currentUser) return;
    showLoader();
    const statiCibo = ["da fare", "in elaborazione", "completato"];
    const statiBere = ["da fare", "in elaborazione", "completato"];
    const listaDiv = document.getElementById("listaComandeAdmin");
    db.ref("comande").off(); // pulizia totale
    db.ref("comande").on("value", async snap => {
		const data = snap.val() || {};
        if (typeof aggiornaDashboardAdmin === "function") aggiornaDashboardAdmin(data);
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
            listaDiv.innerHTML = "<div style='text-align:center; padding: 30px; color: #777; font-style: italic; font-size: 1.1em;'>Tutto tranquillo qui. Nessuna comanda nel sistema. 🏖️</div>";
			document.getElementById("conteggioComandeAdmin").innerText = 0;
			return;
        }


        snap.forEach(s => {
            const c = s.val(); 
            const id = s.key;

            const { cibo, bere, snack, extra1, extra2, extra3 } = separaComanda(c.piatti || []);
            
            // 🔹 Evita loop: aggiorna solo localmente, non scrivere subito su Firebase
            if ((!snack || snack.length === 0) && c.statoSnack !== "completato") { c.statoSnack = "completato"; setTimeout(() => { db.ref("comande/" + id).update({ statoSnack: "completato" }).catch(err => null); }, 0); }
            if ((!extra1 || extra1.length === 0) && c.statoExtra1 !== "completato") { c.statoExtra1 = "completato"; setTimeout(() => { db.ref("comande/" + id).update({ statoExtra1: "completato" }).catch(err => null); }, 0); }
            if ((!extra2 || extra2.length === 0) && c.statoExtra2 !== "completato") { c.statoExtra2 = "completato"; setTimeout(() => { db.ref("comande/" + id).update({ statoExtra2: "completato" }).catch(err => null); }, 0); }
            if ((!extra3 || extra3.length === 0) && c.statoExtra3 !== "completato") { c.statoExtra3 = "completato"; setTimeout(() => { db.ref("comande/" + id).update({ statoExtra3: "completato" }).catch(err => null); }, 0); }
           
            function formattaPiattoAdmin(i) {
                // --- MAGIA PER PIATTO PRINCIPALE ---
                let nomePulito = i.nome || "";
                let varTxt = "";
                let variantiArray = i.varianti ? (Array.isArray(i.varianti) ? i.varianti : Object.values(i.varianti)) : [];
                
                const regex = /\s*\(([\+\-].*?)\)/;
                const matchMain = nomePulito.match(regex);
                
                if (matchMain) {
                    nomePulito = nomePulito.replace(regex, "").trim();
                    if (variantiArray.length === 0) {
                        let estratti = matchMain[1].split(",");
                        estratti.forEach(ex => {
                            ex = ex.trim();
                            if (ex.startsWith("+")) variantiArray.push({ tipo: "aggiunta", nome: ex.substring(1).trim() });
                            else if (ex.startsWith("-")) {
                                let n = ex.substring(1).trim();
                                if (n.toLowerCase().startsWith("senza ")) n = n.substring(6).trim();
                                variantiArray.push({ tipo: "rimozione", nome: n });
                            }
                        });
                    }
                }

                if (variantiArray.length > 0) {
                    let conteggio = {};
                    variantiArray.forEach(v => {
                        if (!v || !v.tipo) return;
                        let key = v.tipo + "_" + v.nome;
                        if (!conteggio[key]) conteggio[key] = { tipo: v.tipo, nome: v.nome, count: 0 };
                        conteggio[key].count++;
                    });

                    let txt = Object.values(conteggio).map(v => {
                        let nomeExtra = v.nome.charAt(0).toUpperCase() + v.nome.slice(1);
                        let qTxt = v.count > 1 ? `${v.count}x ` : "";
                        if (v.tipo === "aggiunta") return `<span style="color:green; font-weight:bold;">+ ${qTxt}${nomeExtra}</span>`;
                        else return `<span style="color:red; font-weight:bold;">- Senza ${nomeExtra}</span>`;
                    }).join(", ");
                    varTxt = ` <span style="font-size:0.85em;">(${txt})</span>`;
                }

                let base = "";
                if (i.isMainHere !== false) {
                    base = `${i.quantita}x ${nomePulito}${varTxt}`;
                } else {
                    base = `<span style="font-style:italic; color:#777;">[Di: ${i.quantita}x ${nomePulito}]</span>`;
                }

                // --- MAGIA PER CONTORNI ---
                if (i.contorniScelti && i.contorniScelti.length > 0) {
                    let contorniHtml = i.contorniScelti.map(c => {
                        let cNome = c.nome || "";
                        let cVarTxt = "";
                        let cVarArray = c.varianti ? (Array.isArray(c.varianti) ? c.varianti : Object.values(c.varianti)) : [];
                        
                        const matchCont = cNome.match(regex);
                        if (matchCont) {
                            cNome = cNome.replace(regex, "").trim();
                            if (cVarArray.length === 0) {
                                let estratti = matchCont[1].split(",");
                                estratti.forEach(ex => {
                                    ex = ex.trim();
                                    if (ex.startsWith("+")) cVarArray.push({ tipo: "aggiunta", nome: ex.substring(1).trim() });
                                    else if (ex.startsWith("-")) {
                                        let n = ex.substring(1).trim();
                                        if (n.toLowerCase().startsWith("senza ")) n = n.substring(6).trim();
                                        cVarArray.push({ tipo: "rimozione", nome: n });
                                    }
                                });
                            }
                        }

                        if (cVarArray.length > 0) {
                            let conteggioC = {};
                            cVarArray.forEach(v => {
                                if (!v || !v.tipo) return;
                                let key = v.tipo + "_" + v.nome;
                                if (!conteggioC[key]) conteggioC[key] = { tipo: v.tipo, nome: v.nome, count: 0 };
                                conteggioC[key].count++;
                            });
                            let txtC = Object.values(conteggioC).map(v => {
                                let nomeExtra = v.nome.charAt(0).toUpperCase() + v.nome.slice(1);
                                let qTxt = v.count > 1 ? `${v.count}x ` : "";
                                if (v.tipo === "aggiunta") return `<span style="color:green; font-weight:bold;">+ ${qTxt}${nomeExtra}</span>`;
                                else return `<span style="color:red; font-weight:bold;">- Senza ${nomeExtra}</span>`;
                            }).join(", ");
                            cVarTxt = ` <span style="font-size:0.85em;">(${txtC})</span>`;
                        }

                        return `↳ ${i.quantita}x ${cNome}${cVarTxt}`;
                    }).join("<br>");
                    
                    base += `<br><span style="margin-left:15px; font-size:0.9em; color:#333;">${contorniHtml}</span>`;
                }

                return base;
            }

            const piattiCibo = cibo.map(formattaPiattoAdmin).join(" <br> ") || "—";
            const piattiBere = bere.map(formattaPiattoAdmin).join(" <br> ") || "—";
            const piattiSnack = snack && snack.length ? snack.map(formattaPiattoAdmin).join(" <br> ") : null;
            const piattiExtra1 = extra1 && extra1.length ? extra1.map(formattaPiattoAdmin).join(" <br> ") : null;
            const piattiExtra2 = extra2 && extra2.length ? extra2.map(formattaPiattoAdmin).join(" <br> ") : null;
            const piattiExtra3 = extra3 && extra3.length ? extra3.map(formattaPiattoAdmin).join(" <br> ") : null;

            const riga = document.createElement("div");
            riga.className = "order";
            riga.id = "admin_comanda_" + id;
            riga.dataset.numero = (c.numero + (c.lettera || "")).toUpperCase();
			// Aggiungo i metadati per la ricerca avanzata
            riga.dataset.tavolo = c.tavolo ? c.tavolo.toString().toLowerCase() : "";
            riga.dataset.orario = c.orario || "";
            
            // Estraggo tutti i nomi dei piatti in una stringa per facilitare la ricerca prodotto
            const stringaPiatti = (c.piatti || []).map(p => p.nome).join(" ").toLowerCase();
            riga.dataset.prodotti = stringaPiatti;

            // 1. PRIMA creo il mainDiv e il numDiv
            const mainDiv = document.createElement("div");
            mainDiv.style.display = "flex"; mainDiv.style.justifyContent = "space-between"; mainDiv.style.alignItems = "flex-start"; mainDiv.style.gap = "20px";
            
            const numDiv = document.createElement("div"); 
            numDiv.innerHTML = `<b>#${c.numero}</b>`; 
            
            // 2. DOPO posso aggiungere l'etichetta visiva del tavolo
            if (c.tavolo) {
                numDiv.innerHTML += ` <span style="color:#007bff; margin-left: 10px;">(🪑 Tav: ${c.tavolo})</span>`;
            }

            // 3. Infine assemblo il tutto
            mainDiv.appendChild(numDiv);
            riga.appendChild(mainDiv);
			
            if (c.commento) { 
                const asportoDiv = document.createElement("div"); asportoDiv.className = "asportoLabel"; asportoDiv.innerText = c.commento; asportoDiv.style.margin = "4px 0 6px 0.8cm"; riga.appendChild(asportoDiv); 
            }

           
            const piattiDiv = document.createElement("div");
			piattiDiv.className = "orderContent";
			piattiDiv.innerHTML = `
			    <div>Piatti: ${piattiCibo}</div>
			    <div>Bevande: ${piattiBere}</div>
			    ${snackAbilitato ? `<div>Snack: ${piattiSnack || "—"}</div>` : ""}
			    ${window.settings?.extra1Abilitato ? `<div>${window.nomiRepartiExtra?.extra1 || "Extra 1"}: ${piattiExtra1 || "—"}</div>` : ""}
			    ${window.settings?.extra2Abilitato ? `<div>${window.nomiRepartiExtra?.extra2 || "Extra 2"}: ${piattiExtra2 || "—"}</div>` : ""}
			    ${window.settings?.extra3Abilitato ? `<div>${window.nomiRepartiExtra?.extra3 || "Extra 3"}: ${piattiExtra3 || "—"}</div>` : ""}
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
                container.className = "btnStatoContainer"; 

                // TRADUCI IL NOME EXTRA SE ESISTE
                let labelTipo = tipo.charAt(0).toUpperCase() + tipo.slice(1);
                if (tipo.startsWith("extra")) {
                    labelTipo = window.nomiRepartiExtra?.[tipo] || labelTipo;
                }

                const statoSpan = document.createElement("div");
                statoSpan.innerHTML = `<b style="white-space: nowrap;">Stato ${labelTipo}:</b> ${statoAttuale}`;
                statoSpan.style.fontWeight = "bold";
                statoSpan.style.fontSize = "0.9em";
                statoSpan.style.color = (statoAttuale === "completato") ? "green" :
                                        (statoAttuale === "in elaborazione") ? "orange" : "red";

                const btn = document.createElement("button");
                // Crea logica per la label dinamica
                let testoBtn = "", coloreBtn = "";
                if (statoAttuale === "da fare") { testoBtn = "Segna in elaborazione"; coloreBtn = "orange"; }
                else if (statoAttuale === "in elaborazione") { testoBtn = "Segna completato"; coloreBtn = "green"; }
                else { testoBtn = "Segna da fare"; coloreBtn = "red"; }
                
                btn.innerText = testoBtn;
                btn.style.background = coloreBtn;
                btn.style.color = "white";

                btn.onclick = async () => {
				    let nuovo;
				    let aggiornamenti = {}; // Oggetto per mandare più dati a Firebase insieme
				
				    if (statoAttuale === "da fare") nuovo = "in elaborazione";
				    else if (statoAttuale === "in elaborazione") {
				        nuovo = "completato";
				        // 🔹 SALVIAMO L'ORA DI COMPLETAMENTO PER QUESTO REPARTO!
				        aggiornamenti["timestampFine_" + tipo] = Date.now();
				    }
				    else nuovo = "da fare";
				    
				    // Assegna il nuovo stato
				    const chiave = "stato" + tipo.charAt(0).toUpperCase() + tipo.slice(1);
				    aggiornamenti[chiave] = nuovo;
				
				    // Invia tutto a Firebase
				    await db.ref("comande/" + idComanda).update(aggiornamenti);
				};

                container.appendChild(statoSpan);
                container.appendChild(btn);
                return container;
            }

            // Uso:
            buttonsDiv.appendChild(creaBtnConStato(c.statoCucina, "cucina", id));
            buttonsDiv.appendChild(creaBtnConStato(c.statoBere, "bere", id));

            // 🔹 Mostra sempre il tasto se l'impostazione è attiva (anche se la comanda non ha piatti lì)
            if (snackAbilitato) buttonsDiv.appendChild(creaBtnConStato(c.statoSnack || "completato", "snack", id));
            if (window.settings?.extra1Abilitato) buttonsDiv.appendChild(creaBtnConStato(c.statoExtra1 || "completato", "extra1", id));
            if (window.settings?.extra2Abilitato) buttonsDiv.appendChild(creaBtnConStato(c.statoExtra2 || "completato", "extra2", id));
            if (window.settings?.extra3Abilitato) buttonsDiv.appendChild(creaBtnConStato(c.statoExtra3 || "completato", "extra3", id));


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

// ================= DASHBOARD ADMIN (STILE BISTROBO AVANZATO) =================
function aggiornaDashboardAdmin(comandeData) {
    if (!document.getElementById("dashboardAdminTab")) return;

    const repartiConfig = [
        { id: "cucina", nome: "Cucina", statoKey: "statoCucina", abil: true, colore: "#FF9800" }, 
        { id: "bere", nome: "Bar / Bere", statoKey: "statoBere", abil: true, colore: "#2196F3" }, 
        { id: "snack", nome: "Snack", statoKey: "statoSnack", abil: window.settings?.snackAbilitato, colore: "#FFC107" },
        { id: "extra1", nome: window.nomiRepartiExtra?.extra1 || "Extra 1", statoKey: "statoExtra1", abil: window.settings?.extra1Abilitato, colore: "#9C27B0" },
        { id: "extra2", nome: window.nomiRepartiExtra?.extra2 || "Extra 2", statoKey: "statoExtra2", abil: window.settings?.extra2Abilitato, colore: "#4CAF50" },
        { id: "extra3", nome: window.nomiRepartiExtra?.extra3 || "Extra 3", statoKey: "statoExtra3", abil: window.settings?.extra3Abilitato, colore: "#F44336" }
    ].filter(r => r.abil);

    const statsReparti = {};
    repartiConfig.forEach(r => {
        statsReparti[r.id] = { inCoda: 0, tempiEvasione: [], fastest: Infinity, oldestTimestamp: null, oldestId: null };
    });

    const now = Date.now();
    let maxGlobalStress = 0;
	// --- VARIABILI PER CLIENTI SERVITI ---
    let clientiCompletati = 0;
    let primoOrdineTimestamp = Infinity;
    let ultimoCompletamentoTimestamp = 0;

    // 1. Raccolta Dati
    Object.entries(comandeData).forEach(([id, c]) => {
        const { cibo, bere, snack, extra1, extra2, extra3 } = separaComanda(c.piatti || []);
        
        repartiConfig.forEach(r => {
            let hasItems = false;
            if (r.id === "cucina" && cibo.length > 0) hasItems = true;
            if (r.id === "bere" && bere.length > 0) hasItems = true;
            if (r.id === "snack" && snack.length > 0) hasItems = true;
            if (r.id === "extra1" && extra1.length > 0) hasItems = true;
            if (r.id === "extra2" && extra2.length > 0) hasItems = true;
            if (r.id === "extra3" && extra3.length > 0) hasItems = true;

            if (hasItems) {
                const stato = c[r.statoKey] || "da fare";
                
                if (stato === "da fare" || stato === "in elaborazione") {
                    statsReparti[r.id].inCoda++;
                    if (!statsReparti[r.id].oldestTimestamp || c.timestamp < statsReparti[r.id].oldestTimestamp) {
                        statsReparti[r.id].oldestTimestamp = c.timestamp;
                        statsReparti[r.id].oldestId = (c.numero + (c.lettera || "")).toUpperCase();
                    }
                } 
                else if (stato === "completato" && c.timestamp && c["timestampFine_" + r.id]) {
                    let durata = c["timestampFine_" + r.id] - c.timestamp;
                    if (durata > 0 && durata < 86400000) { 
                        statsReparti[r.id].tempiEvasione.push(durata);
                        if (durata < statsReparti[r.id].fastest) statsReparti[r.id].fastest = durata;
                    }
                }
            }
        });
		// --- CALCOLO CLIENTI TOTALMENTE SERVITI ---
        // Verifichiamo se TUTTI i reparti coinvolti in questa comanda l'hanno completata
        let comandaFinita = true;
        let comandaIniziata = false;

        repartiConfig.forEach(r => {
            // Controlla se il reparto ha piatti in questa comanda
            let haPiatti = false;
            if (r.id === "cucina" && cibo.length > 0) haPiatti = true;
            if (r.id === "bere" && bere.length > 0) haPiatti = true;
            if (r.id === "snack" && snack.length > 0) haPiatti = true;
            if (r.id === "extra1" && extra1.length > 0) haPiatti = true;
            if (r.id === "extra2" && extra2.length > 0) haPiatti = true;
            if (r.id === "extra3" && extra3.length > 0) haPiatti = true;

            if (haPiatti) {
                comandaIniziata = true;
                if (c[r.statoKey] !== "completato") {
                    comandaFinita = false;
                } else {
                    // Troviamo l'ultimo timestamp di completamento per questa comanda
                    if (c["timestampFine_" + r.id] && c["timestampFine_" + r.id] > ultimoCompletamentoTimestamp) {
                        ultimoCompletamentoTimestamp = c["timestampFine_" + r.id];
                    }
                }
            }
        });

        // Se la comanda è valida e finita, incrementiamo i clienti
        if (comandaIniziata && comandaFinita) {
            clientiCompletati++;
        }

        // Troviamo il timestamp del primissimo ordine per calcolare la durata della serata
        if (c.timestamp && c.timestamp < primoOrdineTimestamp) {
            primoOrdineTimestamp = c.timestamp;
        }
    });

    // 2. Trova il reparto più veloce (Medaglia)
    let bestAvg = Infinity;
    let fastestDeptId = null;
    repartiConfig.forEach(r => {
        const sr = statsReparti[r.id];
        if (sr.tempiEvasione.length > 0) {
            let sum = sr.tempiEvasione.reduce((a, b) => a + b, 0);
            let avg = sum / sr.tempiEvasione.length;
            if (avg < bestAvg) {
                bestAvg = avg;
                fastestDeptId = r.id;
            }
        }
    });

    // 3. Render della Griglia
    let gridHtml = "";
    repartiConfig.forEach(r => {
        const sr = statsReparti[r.id];
        
        // Sovraccarico dalle 15 comande in poi
        let stressPercent = Math.min((sr.inCoda / 15) * 100, 100); 
        let stressColor = "#4CAF50"; // Verde
        if (sr.inCoda >= 10) stressColor = "#FF9800"; // Giallo
        if (sr.inCoda >= 15) stressColor = "#F44336"; // Rosso
        
        if (sr.inCoda >= 15 && maxGlobalStress < 2) maxGlobalStress = 2;
        else if (sr.inCoda >= 10 && maxGlobalStress < 1) maxGlobalStress = 1;

        // Calcolo Medie
        let mediaMin = "--";
        if (sr.tempiEvasione.length > 0) {
            let sum = sr.tempiEvasione.reduce((a, b) => a + b, 0);
            mediaMin = (sum / sr.tempiEvasione.length / 60000).toFixed(1) + " min";
        }
        let fastestText = sr.fastest !== Infinity ? (sr.fastest / 60000).toFixed(1) + " min" : "--";

        // Gestione Ritardi (> 30 min)
        let minPassati = sr.oldestTimestamp ? Math.floor((now - sr.oldestTimestamp) / 60000) : 0;
        let oldestText = sr.oldestTimestamp 
            ? `#${sr.oldestId} (${minPassati}m fa)`
            : "Nessuna in coda";

        let alertHtml = "";
        if (sr.oldestTimestamp && minPassati >= 30) {
            alertHtml = `<div style="background:#FFEBEE; color:#D32F2F; font-size:0.7em; padding:4px 8px; border-radius:6px; font-weight:bold; align-self: flex-start;">⚠️ RITARDI RILEVATI</div>`;
        }

        let trofeo = r.id === fastestDeptId ? `<span title="Reparto più veloce" style="font-size:1.1em;"> 🏆</span>` : '';

        // Sostituito bb-card-title con un layout Flex per tenere il badge ritardi sotto
        gridHtml += `
            <div class="bb-dash-card" style="--dept-color: ${r.colore}; display: flex; flex-direction: column;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                    <div style="display: flex; flex-direction: column; gap: 6px;">
                        <span style="font-weight: bold; font-size: 1.3em; color: #333;">${r.nome}${trofeo}</span>
                        ${alertHtml}
                    </div>
                    <div style="text-align: right; line-height: 1;">
                        <div style="font-size: 1.8em; font-weight: bold; color: ${stressColor};">${sr.inCoda}</div>
                        <div style="color: ${stressColor}; font-weight: bold; font-size: 0.9em; margin-top: 2px;">Attive</div>
                    </div>
                </div>
                <div class="bb-gauge-bg" style="margin-bottom: 12px;">
                    <div class="bb-gauge-fill" style="width: ${stressPercent}%; background-color: ${stressColor};"></div>
                </div>
                <div style="display: flex; flex-direction: column; gap: 8px; font-size: 0.9em; flex-grow: 1;">
                    <div class="bb-stat-row"><span>In attesa da più tempo:</span> <span class="bb-stat-val">${oldestText}</span></div>
                    <div class="bb-stat-row"><span>Tempo Medio Evasione:</span> <span class="bb-stat-val">${mediaMin}</span></div>
                    <div class="bb-stat-row"><span>Record di Velocità:</span> <span class="bb-stat-val">${fastestText}</span></div>
                </div>
            </div>
        `;
    });

    const contenitoreReparti = document.getElementById("bb-departments");
    // Forziamo il layout Grid a 4 colonne (minimo ~240px per scheda, altrimenti va a capo)
    contenitoreReparti.style.display = "grid";
    contenitoreReparti.style.gridTemplateColumns = "repeat(auto-fit, minmax(240px, 1fr))";
    contenitoreReparti.style.gap = "15px";
    contenitoreReparti.innerHTML = gridHtml;

    // 4. Aggiornamento Status Globale
    const globalStatusDiv = document.getElementById("bb-global-status");
    if (maxGlobalStress === 2) {
        globalStatusDiv.className = "bb-status-badge crit"; globalStatusDiv.innerText = "⚠ Sovraccarico Rilevato";
    } else if (maxGlobalStress === 1) {
        globalStatusDiv.className = "bb-status-badge warn"; globalStatusDiv.innerText = "⚡ Carico Elevato";
    } else {
        globalStatusDiv.className = "bb-status-badge ok"; globalStatusDiv.innerText = "✔️ Flusso Regolare";
    }
// --- AGGIORNAMENTO UI CLIENTI SERVITI E RITMO ---
    const elClienti = document.getElementById("dashClientiServiti");
    const elRitmo = document.getElementById("dashRitmoServizio");
    
    if (elClienti && elRitmo) {
        elClienti.innerText = clientiCompletati;

        if (clientiCompletati > 1 && primoOrdineTimestamp !== Infinity && ultimoCompletamentoTimestamp > primoOrdineTimestamp) {
            // Calcolo tempo trascorso in secondi tra il primo ordine e l'ultimo piatto uscito
            const tempoTrascorsoSec = (ultimoCompletamentoTimestamp - primoOrdineTimestamp) / 1000;
            const secondiPerCliente = Math.floor(tempoTrascorsoSec / clientiCompletati);
            
            if (secondiPerCliente > 0) {
                // Formattiamo il ritmo per renderlo leggibile
                let ritmoText = "";
                if (secondiPerCliente < 60) {
                    ritmoText = `1 cliente ogni ${secondiPerCliente}s`;
                } else {
                    const min = Math.floor(secondiPerCliente / 60);
                    const sec = secondiPerCliente % 60;
                    ritmoText = `1 cliente ogni ${min}m ${sec}s`;
                }
                elRitmo.innerText = `(${ritmoText})`;
            } else {
                elRitmo.innerText = "( Troppo veloci! ⚡ )";
            }
        } else {
            elRitmo.innerText = "( Calcolo in corso... )";
        }
    }
} // <-- Questa è l'ultima parentesi graffa della funzione

// ================= POPUP ESCLUSIONE TEMPO CASSA (DESIGN INTEGRATO BISTROBO) =================
function apriConfigurazioneTempoCassa() {
    db.ref("impostazioni/esclusioniTempoCassa").once("value").then(snap => {
        // Aggiunto "cucina: false" come valore di default qualora non ci fosse
        let esclusioni = snap.val() || { cucina: false, bere: false, snack: false, extra1: false, extra2: false, extra3: false };
        
        const div = document.createElement("div");
        div.id = "modalFiltroCassa";
        div.className = "modal-overlay"; // Applica lo sfondo scuro globale
        div.style.zIndex = "10005";
        
        div.innerHTML = `
            <div class="modal-varianti" style="text-align: center;">
                <h3 style="margin-top: 0; margin-bottom: 5px; color: #333;">⏱️ Filtri Tempo Medio</h3>
                <p style="font-size: 0.9em; color: #666; margin-bottom: 20px;">Seleziona i reparti da escludere dal conteggio:</p>
                
                <div style="text-align: left;">
                    <div class="settingItem" style="padding: 10px 15px; margin-bottom: 5px;">
                        <div><strong>Cucina</strong></div>
                        <input type="checkbox" id="escl-cucina" ${esclusioni.cucina ? "checked" : ""} style="transform: scale(1.3);">
                    </div>
                    <div class="settingItem" style="padding: 10px 15px; margin-bottom: 5px;">
                        <div><strong>Bere</strong></div>
                        <input type="checkbox" id="escl-bere" ${esclusioni.bere ? "checked" : ""} style="transform: scale(1.3);">
                    </div>
                    <div class="settingItem" style="padding: 10px 15px; margin-bottom: 5px;">
                        <div><strong>Snack</strong></div>
                        <input type="checkbox" id="escl-snack" ${esclusioni.snack ? "checked" : ""} style="transform: scale(1.3);">
                    </div>
                    <div class="settingItem" style="padding: 10px 15px; margin-bottom: 5px;">
                        <div><strong>${window.nomiRepartiExtra?.extra1 || "Extra 1"}</strong></div>
                        <input type="checkbox" id="escl-extra1" ${esclusioni.extra1 ? "checked" : ""} style="transform: scale(1.3);">
                    </div>
                    <div class="settingItem" style="padding: 10px 15px; margin-bottom: 5px;">
                        <div><strong>${window.nomiRepartiExtra?.extra2 || "Extra 2"}</strong></div>
                        <input type="checkbox" id="escl-extra2" ${esclusioni.extra2 ? "checked" : ""} style="transform: scale(1.3);">
                    </div>
                    <div class="settingItem" style="padding: 10px 15px; margin-bottom: 15px;">
                        <div><strong>${window.nomiRepartiExtra?.extra3 || "Extra 3"}</strong></div>
                        <input type="checkbox" id="escl-extra3" ${esclusioni.extra3 ? "checked" : ""} style="transform: scale(1.3);">
                    </div>
                </div>

                <div class="modal-actions" style="margin-top: 20px;">
                    <button class="btn-chiudi" onclick="document.getElementById('modalFiltroCassa').remove()">Annulla</button>
                    <button class="btn-salva" onclick="salvaConfigurazioneTempoCassa()">Salva</button>
                </div>
            </div>
        `;
        document.body.appendChild(div);
    });
}

async function salvaConfigurazioneTempoCassa() {
    // Includi 'cucina' nell'oggetto di configurazione
    const config = {
        cucina: document.getElementById("escl-cucina").checked,
        bere: document.getElementById("escl-bere").checked,
        snack: document.getElementById("escl-snack").checked,
        extra1: document.getElementById("escl-extra1").checked,
        extra2: document.getElementById("escl-extra2").checked,
        extra3: document.getElementById("escl-extra3").checked
    };

    try {
        await db.ref("impostazioni/esclusioniTempoCassa").set(config);
        document.getElementById('modalFiltroCassa').remove();
        if (typeof notify === "function") {
            notify("Impostazioni salvate con successo!", "success");
        }
    } catch(err) {
        console.error("Errore salvataggio esclusioni tempo cassa", err);
        if (typeof notify === "function") notify("Errore nel salvataggio", "error");
    }
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
                const extra1Nuovo = comandaTemp.piatti.some(p => p.categoria === "extra1" || p.tipo === "extra1");
                const extra2Nuovo = comandaTemp.piatti.some(p => p.categoria === "extra2" || p.tipo === "extra2");
                const extra3Nuovo = comandaTemp.piatti.some(p => p.categoria === "extra3" || p.tipo === "extra3");

                const updateData = {
                    piatti: comandaTemp.piatti,
                    statoCucina: ciboNuovo ? "da fare" : "completato",
                    statoBere: bereNuovo ? "da fare" : "completato"
                };
                
                if (snackNuovo) updateData.statoSnack = "da fare"; else updateData.statoSnack = null;
                if (extra1Nuovo) updateData.statoExtra1 = "da fare"; else updateData.statoExtra1 = null;
                if (extra2Nuovo) updateData.statoExtra2 = "da fare"; else updateData.statoExtra2 = null;
                if (extra3Nuovo) updateData.statoExtra3 = "da fare"; else updateData.statoExtra3 = null;

                await db.ref("comande/" + id).update(updateData);
                
                if (!snackNuovo) await db.ref("comande/" + id + "/statoSnack").remove();
                if (!extra1Nuovo) await db.ref("comande/" + id + "/statoExtra1").remove();
                if (!extra2Nuovo) await db.ref("comande/" + id + "/statoExtra2").remove();
                if (!extra3Nuovo) await db.ref("comande/" + id + "/statoExtra3").remove();
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
        
        // FIX: Recuperiamo i costi dei contorni anche nell'admin
        let costoContorni = 0;
        if (piatto.contorniScelti && piatto.contorniScelti.length > 0) {
            piatto.contorniScelti.forEach(c => {
                costoContorni += (c.prezzoPagato || 0) + (c.extraPrezzo || 0);
            });
        }
        piatto.extraPrezzo = tempExtraPrezzo + costoContorni;

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
       // Aggiungi una mappa dinamica o una serie di condizioni inclusivi di extra
        const containerMap = {
            cucina: { fare: "daFareComandeContainer", sto: "storicoComandeContainer" },
            bere: { fare: "daBereComandeContainer", sto: "storicoBereComandeContainer" },
            snack: { fare: "daSnackComandeContainer", sto: "storicoSnackComandeContainer" },
            extra1: { fare: "daExtra1ComandeContainer", sto: "storicoExtra1ComandeContainer" }, // CORRETTO
            extra2: { fare: "daExtra2ComandeContainer", sto: "storicoExtra2ComandeContainer" }, // CORRETTO
            extra3: { fare: "daExtra3ComandeContainer", sto: "storicoExtra3ComandeContainer" }, // CORRETTO
        };

        const daFareContainer = document.getElementById(containerMap[ruoloEffettivo]?.fare);
        const storicoContainer = document.getElementById(containerMap[ruoloEffettivo]?.sto);


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
            const statoKey = ruolo.startsWith("extra") ? "stato" + ruolo.charAt(0).toUpperCase() + ruolo.slice(1) : 
                            (ruolo === "cucina" ? "statoCucina" : 
                            (ruolo === "bere" ? "statoBere" : "statoSnack"));
            // 🔹 Se la comanda non contiene piatti per questo ruolo, salta
            const { cibo, bere, snack, extra1, extra2, extra3 } = separaComanda(c.piatti || []);
			
			if (ruoloEffettivo === "cucina" && cibo.length === 0) return;
			if (ruoloEffettivo === "bere" && bere.length === 0) return;
			if (ruoloEffettivo === "snack" && snackAbilitato && snack.length === 0) return;
			if (ruoloEffettivo === "extra1" && window.settings.extra1Abilitato && extra1.length === 0) return;
			if (ruoloEffettivo === "extra2" && window.settings.extra2Abilitato && extra2.length === 0) return;
			if (ruoloEffettivo === "extra3" && window.settings.extra3Abilitato && extra3.length === 0) return;

            // 🔹 Separa per ruolo ed ordina temporalmente
			let items;
			if (ruoloEffettivo === "cucina") {
			    items = cibo;
			} else if (ruoloEffettivo === "bere") {
			    items = bere;
			} else if (ruoloEffettivo === "snack" && snackAbilitato) {
			    items = snack;
			    if (window.settings.nuoveInAltoSnack) {
			        items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)); // ON: nuove in alto
			    } else {
			        items.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)); // OFF: vecchie in alto
			    }
			} else if (ruoloEffettivo === "extra1" && window.settings.extra1Abilitato) {
			    items = extra1;
			    if (window.settings.nuoveInAltoExtra1) {
			        items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)); // ON: nuove in alto
			    } else {
			        items.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)); // OFF: vecchie in alto
			    }
			} else if (ruoloEffettivo === "extra2" && window.settings.extra2Abilitato) {
			    items = extra2;
			    if (window.settings.nuoveInAltoExtra2) {
			        items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)); // ON: nuove in alto
			    } else {
			        items.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)); // OFF: vecchie in alto
			    }
			} else if (ruoloEffettivo === "extra3" && window.settings.extra3Abilitato) {
			    items = extra3;
			    if (window.settings.nuoveInAltoExtra3) {
			        items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)); // ON: nuove in alto
			    } else {
			        items.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)); // OFF: vecchie in alto
			    }
			} else {
			    // Reparto disattivo → non mostrare nulla in questo ruolo
			    return;
			}


            // 🔹 Crea div comanda
            const d = document.createElement("div");
            d.className = "order";
            d.id = "ruolo_comanda_" + id + "_" + ruolo;
            d.dataset.numero = (c.numero + (c.lettera || "")).toUpperCase();
			d.dataset.tavolo = c.tavolo ? c.tavolo.toString().toLowerCase() : "";
            d.dataset.orario = c.orario || "";
            d.dataset.prodotti = (c.piatti || []).map(p => p.nome).join(" ").toLowerCase();

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
                    
                    const isActiveState = ((ruolo === "cucina" || ruolo === "bere" || (ruolo === "snack" && snackAbilitato) || (ruolo === "extra1" && window.settings.extra1Abilitato) || (ruolo === "extra2" && window.settings.extra2Abilitato) || (ruolo === "extra3" && window.settings.extra3Abilitato)) && (c[statoKey] === "da fare" || c[statoKey] === "in elaborazione"));
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

                            if (isActiveState) {
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

                if (ruolo === "cucina" || ruolo === "bere" || (ruolo === "snack" && snackAbilitato) || (ruolo === "extra1" && window.settings.extra1Abilitato) || (ruolo === "extra2" && window.settings.extra2Abilitato) || (ruolo === "extra3" && window.settings.extra3Abilitato)) {
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
                    if ((ruolo === "cucina" || ruolo === "bere" || (ruolo === "snack" && snackAbilitato) || (ruolo === "extra1" && window.settings.extra1Abilitato) || (ruolo === "extra2" && window.settings.extra2Abilitato) || (ruolo === "extra3" && window.settings.extra3Abilitato)) && [...d.querySelectorAll(".tickItem")].some(cb => !cb.checked)) return;

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
            } else if (ruolo === "extra1" && window.settings.extra1Abilitato) {
                if (window.settings.nuoveInAltoExtra1) daFareContainer.prepend(d);
                else daFareContainer.appendChild(d);
            } else if (ruolo === "extra2" && window.settings.extra2Abilitato) {
                if (window.settings.nuoveInAltoExtra2) daFareContainer.prepend(d);
                else daFareContainer.appendChild(d);
            } else if (ruolo === "extra3" && window.settings.extra3Abilitato) {
                if (window.settings.nuoveInAltoExtra3) daFareContainer.prepend(d);
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
		// --- 1. FIX CONTATORE ---
        // Calcola quanti elementi ci sono attualmente nel container "da fare"
        const countDaFare = daFareContainer.querySelectorAll('.order').length;
        const counterSpanId = ruoloEffettivo === "cucina" ? "conteggioCucina" :
                              ruoloEffettivo === "bere"   ? "conteggioBere" : "conteggioSnack";
        const counterSpan = document.getElementById(counterSpanId);
        if (counterSpan) counterSpan.innerText = countDaFare;

        // --- EMPTY STATES CUCINA / BERE / SNACK / EXTRA ---
		if (daFareContainer.children.length === 0) {
		    let msg = "";
		    if (ruoloEffettivo === "cucina") {
		        msg = "Nessuna comanda in coda. Pentole a riposo! 🍳";
		    } else if (ruoloEffettivo === "bere") {
		        msg = "Nessuna bevanda da preparare. Shaker a riposo! 🍹";
		    } else if (ruoloEffettivo === "snack") {
		        msg = "Nessuno snack in coda. Friggitrice in pausa! 🍟";
		    } else {
		        // Frase generica ma simpatica per Extra1, Extra2, Extra3 (indipendente se fanno pizze, crepes o altro)
		        msg = "Tutto calmo in questo reparto. Prendi fiato finché puoi! 🧘‍♂️✨"; 
		    }
		    daFareContainer.innerHTML = `<div style='text-align:center; padding: 20px; color: #777; font-style: italic; font-size: 1.1em;'>${msg}</div>`;
		}
		
		if (storicoContainer.children.length === 0) {
		    let msg = "";
		    if (ruoloEffettivo === "cucina") {
		        msg = "Ancora nessun piatto completato. Accendi i fuochi! 🔥";
		    } else if (ruoloEffettivo === "bere") {
		        msg = "Nessun drink servito. Stappa qualcosa! 🍾";
		    } else if (ruoloEffettivo === "snack") {
		        msg = "Ancora nessuno snack servito. Scalda l'olio! 🥔";
		    } else {
		        // Frase generica per la tab storico degli Extra
		        msg = "Storico vuoto. Inizia a servire ordini per riempirlo! 💪🚀"; 
		    }
		    storicoContainer.innerHTML = `<div style='text-align:center; padding: 20px; color: #777; font-style: italic; font-size: 1.1em;'>${msg}</div>`;
		}

    });
}
// =========================================================================
// GESTIONE VISIBILITÀ PIATTI NELLA PAGINA PUBBLICA DEI PREORDINI
// =========================================================================
// Event Listeners per Apertura e Chiusura Popup
document.getElementById("btnGestioneVisibilitaPreordini").addEventListener("click", apriPopupVisibilitaPreordini);
document.getElementById("btnChiudiVisibilitaPreordini").addEventListener("click", () => {
    // Chiudiamo la modale forzando il display none
    document.getElementById("popupVisibilitaPreordini").style.display = "none";
});

function apriPopupVisibilitaPreordini() {
    const container = document.getElementById("listaPiattiVisibilitaContainer");
    container.innerHTML = "<p style='text-align:center; font-style:italic; color:#777;'>Caricamento menù...</p>";
    
    // Mostriamo la modale forzando il display flex
    document.getElementById("popupVisibilitaPreordini").style.display = "flex";

    // Leggiamo l'intero menù da Firebase
    firebase.database().ref("menu").once("value", (snapshot) => {
        container.innerHTML = "";
        const menuData = snapshot.val();
        
        if (!menuData) {
            container.innerHTML = "<p style='text-align:center; color:red;'>Nessun piatto presente nel menù.</p>";
            return;
        }

        // Cicliamo i piatti nel menù
        for (let idPiatto in menuData) {
            const piatto = menuData[idPiatto];
            
            // Se la proprietà 'visibilePreordini' non esiste o non è esplicitamente false, di base è TRUE
            const isVisible = (piatto.visibilePreordini !== false);
            const checkedAttr = isVisible ? "checked" : "";

            // Creiamo la riga riutilizzando la classe 'variante-row' del tuo CSS
            const riga = document.createElement("div");
            riga.className = "variante-row";
            riga.style.padding = "10px 0";
            riga.innerHTML = `
                <div style="display: flex; flex-direction: column;">
                    <span style="font-weight: 600; color: #333;">${piatto.nome}</span>
                    <small style="color: #777; text-transform: uppercase; font-size: 0.75em;">Cat: ${piatto.categoria || 'cibi'}</small>
                </div>
                <label class="switch" style="display: inline-flex; align-items: center; gap: 8px; cursor: pointer;">
                    <span style="font-size: 0.8em; font-weight: bold; color: ${isVisible ? 'green' : '#999'};">${isVisible ? 'ONLINE' : 'NASCONDO'}</span>
                    <input type="checkbox" data-id="${idPiatto}" ${checkedAttr} style="transform: scale(1.4); cursor: pointer;">
                </label>
            `;

            // Agganciamo il listener del cambio stato alla checkbox di questa riga
            const checkbox = riga.querySelector("input[type='checkbox']");
            checkbox.addEventListener("change", (e) => {
                const idSelected = e.target.getAttribute("data-id");
                const nuovoStatoVisibilita = e.target.checked;
                
                // Aggiorna la label testuale all'istante accanto allo switch
                const labelStato = e.target.previousElementSibling;
                labelStato.innerText = nuovoStatoVisibilita ? 'ONLINE' : 'NASCONDO';
                labelStato.style.color = nuovoStatoVisibilita ? 'green' : '#999';

                // Salvataggio diretto sul record del piatto in Firebase
                firebase.database().ref(`menu/${idSelected}`).update({
                    visibilePreordini: nuovoStatoVisibilita
                }).then(() => {
                    if(typeof notify === "function") {
                        notify(`Stato visibilità di "${piatto.nome}" aggiornato!`, "info");
                    }
                });
            });

            container.appendChild(riga);
        }
    });
}
// =========================================================================
// SISTEMA SCONTI GLOBALI (STUDENTI, OPERAI, BUONI PASTO)
// =========================================================================

window.scontoGlobaleCorrente = null; // Variabile per ricordare lo sconto applicato in Cassa

// 1. Gestione Impostazione ON/OFF
window.numeroScontiGlobali = 0; // Variabile per contare gli sconti esistenti

db.ref("impostazioni/scontiGlobaliAbilitati").on("value", snap => {
    const abilitato = snap.val() || false;
    window.scontiGlobaliAbilitati = abilitato;

    // Aggiorna Bottone Impostazioni
    const btn = document.getElementById("toggleScontiGlobaliBtn");
    if (btn) {
        btn.innerText = abilitato ? "ON" : "OFF";
    }

    // Mostra/Nascondi Div in Admin (RIPRISTINATO A "block" INVECE DI "flex")
    const divAdmin = document.getElementById("gestioneScontiGlobaliDiv");
    if(divAdmin) divAdmin.style.display = abilitato ? "block" : "none";
    
    // CASSA: Mostra la barra SOLO se l'impostazione è ON *E* c'è almeno 1 sconto
    const containerCassa = document.getElementById("scontiGlobaliCassaContainer");
    if(containerCassa) {
        containerCassa.style.display = (abilitato && window.numeroScontiGlobali > 0) ? "block" : "none";
    }
    
    // Se disabilitato, rimuovi lo sconto corrente dalla cassa
    if(!abilitato && window.scontoGlobaleCorrente) {
        if(typeof window.rimuoviScontoGlobaleCassa === "function") window.rimuoviScontoGlobaleCassa(true);
    }
});
// Click sul bottone impostazioni
if(document.getElementById("toggleScontiGlobaliBtn")) {
    document.getElementById("toggleScontiGlobaliBtn").onclick = async () => {
        const snap = await db.ref("impostazioni/scontiGlobaliAbilitati").once("value");
        await db.ref("impostazioni").update({ scontiGlobaliAbilitati: !(snap.val() || false) });
    };
}

// 2. Logica Admin: Crea ed Elimina
window.aggiungiScontoGlobale = async function() {
    const nome = document.getElementById("nomeScontoGlobale").value.trim();
    const tipo = document.getElementById("tipoScontoGlobale").value;
    const valore = parseFloat(document.getElementById("valoreScontoGlobale").value) || 0;

    if(!nome) {
        notify("Inserisci un nome per lo sconto (es. Studenti).", "warning");
        return;
    }
    if(tipo !== "gratis" && valore <= 0) {
        notify("Inserisci un valore maggiore di 0 per lo sconto.", "warning");
        return;
    }

    await db.ref("scontiGlobali").push({ nome, tipo, valore });
    document.getElementById("nomeScontoGlobale").value = "";
    document.getElementById("valoreScontoGlobale").value = "";
    notify("Sconto globale creato con successo!", "success");
};

window.eliminaScontoGlobale = function(id) {
    disonotify("Vuoi eliminare definitivamente questo sconto globale?", {
        confirmText: "Elimina",
        showCancel: true,
        cancelText: "Annulla",
        onConfirm: async () => {
            await db.ref(`scontiGlobali/${id}`).remove();
            notify("Sconto eliminato.", "info");
        }
    });
};
// 3. Render lista in Admin e Bottoni in Cassa
db.ref("scontiGlobali").on("value", snap => {
    const divAdmin = document.getElementById("listaScontiGlobaliAdmin");
    const divCassa = document.getElementById("pulsantiScontiGlobali");
    const containerCassa = document.getElementById("scontiGlobaliCassaContainer");
    
    if(divAdmin) divAdmin.innerHTML = "";
    if(divCassa) divCassa.innerHTML = "";
    
    const data = snap.val() || {};
    
    // Aggiorniamo il contatore e ricalcoliamo la visibilità della Cassa in tempo reale
    window.numeroScontiGlobali = Object.keys(data).length;
    if(containerCassa) {
        containerCassa.style.display = (window.scontiGlobaliAbilitati && window.numeroScontiGlobali > 0) ? "block" : "none";
    }
    
    // Messaggio per l'Admin se non ci sono sconti
    if (window.numeroScontiGlobali === 0 && divAdmin) {
        divAdmin.innerHTML = "<div style='color:#777; font-style:italic;'>Nessuno sconto globale creato.</div>";
    }

    for(let id in data) {
        const s = data[id];
        let desc = s.tipo === "gratis" ? "GRATIS" : (s.tipo === "percentuale" ? `- ${s.valore}%` : `- €${s.valore.toFixed(2)}`);
        
        // Render riga Admin
        if(divAdmin) {
            divAdmin.innerHTML += `
                <div style="display:flex; justify-content:space-between; align-items:center; background:#fff; padding:10px; margin-bottom:8px; border-radius:6px; border:1px solid #ddd; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                    <span style="font-size: 1.1em;"><b>${s.nome}</b> <span style="color:#f57c00; font-weight:bold; margin-left:10px;">(${desc})</span></span>
                    <button onclick="eliminaScontoGlobale('${id}')" style="background:#f44336; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer;">Elimina</button>
                </div>
            `;
        }

        // Render Bottoni in Cassa
        if(divCassa) {
            const btn = document.createElement("button");
            btn.innerText = `${s.nome} (${desc})`;
            btn.style.cssText = "background: #ffb74d; color: #000; padding: 8px 12px; border: 1px solid #f57c00; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 0.95em;";
            btn.onclick = () => applicaScontoGlobaleCassa(id, s);
            divCassa.appendChild(btn);
        }
    }
});

// 4. Azione click su un bottone sconto in cassa
window.applicaScontoGlobaleCassa = function(id, sconto) {
    // Se clicchi lo sconto già attivo, lo rimuove
    if(window.scontoGlobaleCorrente && window.scontoGlobaleCorrente.id === id) {
        window.rimuoviScontoGlobaleCassa();
    } else {
        window.scontoGlobaleCorrente = { id, ...sconto };
        if(typeof aggiornaComandaCorrente === "function") aggiornaComandaCorrente();
        notify(`Sconto '${sconto.nome}' applicato!`, "success");
    }
};

window.rimuoviScontoGlobaleCassa = function(silenzioso = false) {
    if (window.scontoGlobaleCorrente && !silenzioso) {
        notify("Sconto rimosso dal totale.", "info");
    }
    window.scontoGlobaleCorrente = null;
    if(typeof aggiornaComandaCorrente === "function") aggiornaComandaCorrente();
};
async function caricaIngredientiPerRuolo(ruolo) {
    if (!checkOnline(true)) return;
    
    const containerMap = {
	    cucina: "ingredientiCucinaContainer",
	    bere: "ingredientiBereContainer",
	    snack: "ingredientiSnackContainer",
	    extra1: "ingredientiExtra1Container",
	    extra2: "ingredientiExtra2Container",
	    extra3: "ingredientiExtra3Container"
	};
	const containerId = containerMap[ruolo] || "ingredientiSnackContainer";

    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = "Caricamento ingredienti...";

    db.ref("ingredienti").on("value", async snap => {
        const data = snap.val() || {};
        container.innerHTML = "";

        window.ingredientData = data;
        if (typeof aggiornaMenuRuolo === "function") aggiornaMenuRuolo();

        // Sostituisci la vecchia logica hardcoded con questa dinamica!
        let categorieRuolo = [];
        if (ruolo === "cucina") categorieRuolo.push("cibi");
        else if (ruolo === "bere") categorieRuolo.push("bevande");
        else if (["snack", "extra1", "extra2", "extra3"].includes(ruolo)) {
            if (window.settings[ruolo + "Abilitato"]) categorieRuolo.push(ruolo);
        }

        // Aggiungiamo Snack e Extra deviati
        if (ruolo === "cucina" && !window.settings.snackAbilitato) categorieRuolo.push("snack");
        
        ["extra1", "extra2", "extra3"].forEach(ex => {
            if (!window.settings[ex + "Abilitato"]) {
                let CapProf = ex.charAt(0).toUpperCase() + ex.slice(1);
                let fallback = window.settings["fallback" + CapProf] || "cibo";
                let targetRuolo = fallback === "cibo" ? "cucina" : fallback;
                if (targetRuolo === ruolo) categorieRuolo.push(ex);
            }
        });

        // 🔹 CERVELLO CONDIVISO: Trova TUTTI gli ingredienti usati dai piatti assegnati a questo ruolo
        const ingredientiUsati = new Set();
        if (window.menuData) {
            Object.values(window.menuData).forEach(piatto => {
                let catPiatto = (piatto.categoria || "cibi").toLowerCase().trim();
                const lE1 = (window.nomiRepartiExtra?.extra1 || "").toLowerCase().trim();
                const lE2 = (window.nomiRepartiExtra?.extra2 || "").toLowerCase().trim();
                const lE3 = (window.nomiRepartiExtra?.extra3 || "").toLowerCase().trim();
                if (catPiatto === "extra1" || catPiatto === "risto" || (lE1 && catPiatto === lE1)) catPiatto = "extra1";
                else if (catPiatto === "extra2" || (lE2 && catPiatto === lE2)) catPiatto = "extra2";
                else if (catPiatto === "extra3" || (lE3 && catPiatto === lE3)) catPiatto = "extra3";

                // Se il piatto è del nostro ruolo, segniamoci tutti i suoi ingredienti
                if (categorieRuolo.includes(catPiatto) && piatto.ingredienti) {
                    piatto.ingredienti.forEach(ing => ingredientiUsati.add(ing.id));
                }
            });
        }

        // 2. Creiamo una singola lista "piatta" (array) di tutti gli ingredienti autorizzati per questo ruolo
        const ingredientiDaMostrare = [];
        
        Object.entries(data).forEach(([id, ing]) => {
            let cat = (ing.categoria || "cibi").toLowerCase().trim();
            
            // Normalizza per leggere bene Risto o Nomi Extra
            const lE1 = (window.nomiRepartiExtra?.extra1 || "").toLowerCase().trim();
            const lE2 = (window.nomiRepartiExtra?.extra2 || "").toLowerCase().trim();
            const lE3 = (window.nomiRepartiExtra?.extra3 || "").toLowerCase().trim();
            if (cat === "extra1" || cat === "risto" || (lE1 && cat === lE1)) cat = "extra1";
            else if (cat === "extra2" || (lE2 && cat === lE2)) cat = "extra2";
            else if (cat === "extra3" || (lE3 && cat === lE3)) cat = "extra3";

            // MOSTRA se l'ingrediente appartiene alla categoria principale del ruolo OPPURE se è usato in un piatto di questo ruolo
            if (categorieRuolo.includes(cat) || ingredientiUsati.has(id)) {
                // Aggiungiamo un flag per sapere se è un ingrediente "in prestito" da un altro reparto
                let inPrestito = !categorieRuolo.includes(cat);
                ingredientiDaMostrare.push({ id, inPrestito, nomeCatOriginale: cat, ...ing });
            }
        });

        if (ingredientiDaMostrare.length === 0) {
             let msgIngr = "La dispensa è vuota... aria fritta stasera? 🌬️";
             if (ruolo === "cucina") msgIngr = "Niente ingredienti per te. Oggi si ordina la pizza! 🍕";
             if (ruolo === "bere") msgIngr = "Cantina vuota. Fai scorrere l'acqua del rubinetto! 🚰";
             if (ruolo === "snack") msgIngr = "Niente patatine o fritti... Mettiti a dieta! 🥕";
             if (ruolo.startsWith("extra")) msgIngr = `Nessun ingrediente in ${window.nomiRepartiExtra?.[ruolo] || ruolo}. Qui si fa la fame! 👻`;
             
             container.innerHTML = `<div style='text-align:center; padding: 30px; color: #777; font-style: italic; font-size: 1.1em; background: #f9f9f9; border-radius: 10px; margin-top: 20px;'>${msgIngr}</div>`;
             return;
        }

       const fragment = document.createDocumentFragment();

        ingredientiDaMostrare.forEach(ing => {
                // 🔹 CONTENITORE RIGA 
                const row = document.createElement("div");
                row.style.display = "flex";
                row.style.justifyContent = "space-between";
                row.style.alignItems = "center";
                row.style.flexWrap = "wrap";
                row.style.gap = "10px";
                row.style.padding = "8px 0";
                
                // Se è un ingrediente in prestito, mettiamo un'etichetta
                let etichettaPrestito = "";
                if (ing.inPrestito) {
                     let nomeRep = ing.nomeCatOriginale.charAt(0).toUpperCase() + ing.nomeCatOriginale.slice(1);
                     if (ing.nomeCatOriginale.startsWith("extra")) nomeRep = window.nomiRepartiExtra?.[ing.nomeCatOriginale] || nomeRep;
                     etichettaPrestito = `<small style="color:#f57c00; font-weight:normal; margin-left:5px;">[Da ${nomeRep}]</small>`;
                }
                
                // 🔹 BLOCCO 1: NOME A SINISTRA
                const nameSpan = document.createElement("div");
                nameSpan.innerHTML = `${ing.nome} ${etichettaPrestito}`;
                nameSpan.style.fontWeight = "bold";
                nameSpan.style.flex = "1 1 120px";
                
                // 🔹 BLOCCO 2: GRUPPO CONTROLLI A DESTRA
                const controls = document.createElement("div");
                controls.style.display = "flex";
                controls.style.alignItems = "center";
                controls.style.gap = "8px"; // Distanza identica e fissa tra input e testi
                controls.style.flexWrap = "wrap";

                // Input quantità (ora con altezza e bordi fissi per allinearsi ai bottoni)
                const qtyInput = document.createElement("input");
                qtyInput.type = "number";
                qtyInput.min = 0;
                if(typeof abilitaIncrementoDinamico === "function") abilitaIncrementoDinamico(qtyInput);
                qtyInput.value = (ing.rimanente === null || typeof ing.rimanente === "undefined") ? "" : ing.rimanente;
                qtyInput.style.width = "70px";
                qtyInput.step = "any";
                qtyInput.style.height = "32px";
                qtyInput.style.padding = "0 6px";
                qtyInput.style.margin = "0";
                qtyInput.style.border = "1px solid #ccc";
                qtyInput.style.borderRadius = "6px";
                qtyInput.style.boxSizing = "border-box";

                qtyInput.onchange = async (e) => {
                    let newQty = e.target.value === "" ? null : parseFloat(e.target.value);
                    if (newQty !== null && (isNaN(newQty) || newQty < 0)) newQty = 0;
                    await db.ref(`ingredienti/${ing.id}`).update({
                        rimanente: newQty,
                        disponibile: newQty === null ? true : (newQty > 0)
                    });
                };

                // Unità di misura
                const unitaSpan = document.createElement("span");
                unitaSpan.innerText = ing.unita || "pz";
                unitaSpan.style.minWidth = "25px";
                unitaSpan.style.textAlign = "center";
                unitaSpan.style.color = "#555";

                // Stato
                const statoSpan = document.createElement("span");
                statoSpan.style.fontWeight = "bold";
                const isEsaurito = (ing.rimanente === 0);
                statoSpan.style.color = isEsaurito ? "red" : "green";
                statoSpan.innerText = isEsaurito ? "Esaurito" : "Disponibile";
                statoSpan.style.minWidth = "85px"; // Evita che balli quando cambia la parola
                statoSpan.style.textAlign = "center";

                // Bottoni 
                const btnDisp = document.createElement("button");
                btnDisp.innerText = "Disponibile";
                btnDisp.onclick = async () => {
                    await db.ref(`ingredienti/${ing.id}`).update({ rimanente: null, disponibile: true });
                };

                const btnEs = document.createElement("button");
                btnEs.innerText = "Esaurito";
                btnEs.onclick = async () => {
                    await db.ref(`ingredienti/${ing.id}`).update({ rimanente: 0, disponibile: false });
                };

                // Assembliamo i pezzi!
                controls.appendChild(qtyInput);
                controls.appendChild(unitaSpan);
                controls.appendChild(statoSpan);
                controls.appendChild(btnDisp);
                controls.appendChild(btnEs);

                row.appendChild(nameSpan);
                row.appendChild(controls);

                fragment.appendChild(row);

                // Linea separatrice
                const hr = document.createElement("hr");
                hr.style.margin = "0";
                hr.style.border = "none";
                hr.style.borderTop = "1px solid #eee";
                fragment.appendChild(hr);
        });

        container.appendChild(fragment);
    });
}
// -------------------- WALL OF FAME (12 RECORD AUTOMATICI) --------------------

// Cache per non riscaricare tutto l'archivio storico ogni volta che si aggiorna
window.storicoGamificationCache = null;
window.gamificationInterval = null;

window.caricaGamification = async function() {
    if (!checkOnline(true)) return;
    
    // Mostra il loader solo al primissimo caricamento
    const gamificationTab = document.getElementById("gamificationTab");
    if (gamificationTab && !gamificationTab.innerHTML.includes("Wall of Fame")) {
        showLoader();
    }
    
    try {
        // Scarichiamo Comande attuali e Utenti
        const [snapComande, snapUtenti] = await Promise.all([
            db.ref("comande").once("value"),
            db.ref("utenti").once("value")
        ]);
        
        // Se la cache dello storico è vuota, la scarichiamo una volta sola
        if (!window.storicoGamificationCache) {
            const snapStorico = await db.ref("storico_giornate").once("value");
            window.storicoGamificationCache = snapStorico.val() || {};
        }
        
        const comande = snapComande.val() || {};
        const storico = window.storicoGamificationCache;
        const utenti = snapUtenti.val() || {};
        
        const tutteLeComande = [];
        
        // Uniamo le comande di oggi e dello storico
        Object.values(comande).forEach(c => tutteLeComande.push(c));
        Object.values(storico).forEach(giornata => {
            if (giornata.comande) {
                Object.values(giornata.comande).forEach(c => tutteLeComande.push(c));
            }
        });
        
        let statsCassieri = {};
        let statsReparti = {
            cucina: { ordini: 0, tempoTot: 0 },
            bere: { ordini: 0, tempoTot: 0 },
            snack: { ordini: 0, tempoTot: 0 },
            extra1: { ordini: 0, tempoTot: 0 },
            extra2: { ordini: 0, tempoTot: 0 },
            extra3: { ordini: 0, tempoTot: 0 }
        };
        
        // Variabili per i Record
        let fastestBeerTime = Infinity;
        let maxPiattiInOrdine = 0;
        let recordFameNome = "";
        let tartaruga = { reparto: "Nessuno", tempo: 0, nomeOrdine: "" };
        let razzo = { reparto: "Nessuno", tempo: Infinity, nomeOrdine: "" };
        let onFire = { reparto: "Nessuno", ordini: 0 };
        let scontrinoOro = { importo: 0, nomeOrdine: "" };

        // Analizziamo comanda per comanda
        tutteLeComande.forEach(c => {
            const timestamp = c.timestamp || 0;
            
            let totaleOrdine = 0;
            let totalePiatti = 0;
            let haBirra = false;
            
            if (c.piatti) {
                c.piatti.forEach(p => {
                     let pPrezzo = (p.prezzo || 0) + (p.extraPrezzo || 0);
                     let q = p.quantita || 1;
                     totaleOrdine += pPrezzo * q;
                     totalePiatti += q;
                     
                     const n = (p.nome || "").toLowerCase();
                     if (n.includes("birra") || n.includes("beer")) haBirra = true;
                });
            }
            
            // Record: Fame da Lupi (Comanda più grande in assoluto)
            if (totalePiatti > maxPiattiInOrdine) {
                maxPiattiInOrdine = totalePiatti;
                recordFameNome = `Comanda #${c.numero || "?"}`;
            }

            // Record: Scontrino d'Oro (Comanda con incasso maggiore)
            if (totaleOrdine > scontrinoOro.importo) {
                scontrinoOro = { importo: totaleOrdine, nomeOrdine: `Comanda #${c.numero || "?"}` };
            }

            // Statistiche Cassieri
            if (c.uidCassiere) {
                const uid = c.uidCassiere;
                if (!statsCassieri[uid]) {
                    let uName = utenti[uid]?.username || uid;
                    if (uName.includes("@")) uName = uName.split("@")[0]; 
                    statsCassieri[uid] = { nome: uName, ordini: 0, ordiniCompletati: 0, tempoTot: 0, incasso: 0, birre: 0, piattiTotali: 0 };
                }
                
                statsCassieri[uid].ordini++;
                statsCassieri[uid].incasso += totaleOrdine;
                
                if (c.piatti) {
                    c.piatti.forEach(p => {
                        let q = p.quantita || 1;
                        statsCassieri[uid].piattiTotali += q;
                        const n = (p.nome || "").toLowerCase();
                        if (n.includes("birra") || n.includes("beer")) {
                            statsCassieri[uid].birre += q;
                        }
                    });
                }
                
                let maxFine = 0;
                const repartiKeys = ["cucina", "bere", "snack", "extra1", "extra2", "extra3"];
                repartiKeys.forEach(r => {
                    if (c["timestampFine_" + r] > maxFine) maxFine = c["timestampFine_" + r];
                });
                
                if (c.timestampCompletata && c.timestampCompletata > maxFine) maxFine = c.timestampCompletata;
                
                if (maxFine > timestamp) {
                    let tempo = maxFine - timestamp;
                    if (tempo > 0 && tempo < 36000000) { 
                        statsCassieri[uid].tempoTot += tempo;
                        statsCassieri[uid].ordiniCompletati++;
                    }
                }
            }
            
            // Statistiche Reparti
            const repartiKeys = ["cucina", "bere", "snack", "extra1", "extra2", "extra3"];
            repartiKeys.forEach(r => {
                if (c["timestampFine_" + r] && c["timestampFine_" + r] > timestamp) {
                    let tempo = c["timestampFine_" + r] - timestamp;
                    
                    if (tempo > 10000 && tempo < 14400000) { 
                        statsReparti[r].ordini++;
                        statsReparti[r].tempoTot += tempo;
                        
                        // Record: La Tartaruga
                        if (tempo > tartaruga.tempo) {
                            tartaruga = { reparto: r, tempo: tempo, nomeOrdine: `Comanda #${c.numero || "?"}` };
                        }
                        
                        // Record: Il Razzo
                        if (tempo < razzo.tempo) {
                            razzo = { reparto: r, tempo: tempo, nomeOrdine: `Comanda #${c.numero || "?"}` };
                        }
                        
                        // Record: Spillatura Record
                        if (r === "bere" && haBirra && tempo < fastestBeerTime) {
                            fastestBeerTime = tempo;
                        }
                    }
                }
            });
        });
        
        // --- CALCOLO DEI VINCITORI ---
        let bestCassiereTempo = { nome: "Nessuno", val: Infinity };
        let bestCassiereOrdini = { nome: "Nessuno", val: 0 };
        let bestCassiereIncasso = { nome: "Nessuno", val: 0 };
        let bestCassiereBirre = { nome: "Nessuno", val: 0 };
        let bestCassierePiatti = { nome: "Nessuno", val: 0 };
        
        Object.values(statsCassieri).forEach(s => {
            if (s.ordini > bestCassiereOrdini.val) bestCassiereOrdini = { nome: s.nome, val: s.ordini };
            if (s.incasso > bestCassiereIncasso.val) bestCassiereIncasso = { nome: s.nome, val: s.incasso };
            if (s.birre > bestCassiereBirre.val) bestCassiereBirre = { nome: s.nome, val: s.birre };
            if (s.piattiTotali > bestCassierePiatti.val) bestCassierePiatti = { nome: s.nome, val: s.piattiTotali };
            
            if (s.ordiniCompletati >= 5) {
                let media = s.tempoTot / s.ordiniCompletati;
                if (media < bestCassiereTempo.val) bestCassiereTempo = { nome: s.nome, val: media };
            }
        });
        
        let bestRepartoMedia = { nome: "Nessuno", val: Infinity };
        const getNomeReparto = (id) => {
            const nomi = {
                cucina: "Cucina", bere: "Bere", snack: "Snack",
                extra1: window.nomiRepartiExtra?.extra1 || "Extra 1",
                extra2: window.nomiRepartiExtra?.extra2 || "Extra 2",
                extra3: window.nomiRepartiExtra?.extra3 || "Extra 3"
            };
            return nomi[id] || id;
        };
        
        Object.entries(statsReparti).forEach(([k, v]) => {
            if (v.ordini >= 5) {
                let media = v.tempoTot / v.ordini;
                if (media < bestRepartoMedia.val) bestRepartoMedia = { nome: getNomeReparto(k), val: media };
            }
            if (v.ordini > onFire.ordini) {
                onFire = { reparto: k, ordini: v.ordini };
            }
        });

        // Formattazione Tempi
        const formatTime = (ms) => {
            if (ms === Infinity || ms === 0) return "--";
            let totalSecs = Math.floor(ms / 1000);
            let h = Math.floor(totalSecs / 3600);
            let m = Math.floor((totalSecs % 3600) / 60);
            let s = totalSecs % 60;
            if (h > 0) return `${h}h ${m}m`;
            if (m > 0) return `${m}m ${s}s`;
            return `${s}s`;
        };

        if (!gamificationTab) return;

        // COSTRUZIONE GRAFICA (12 CARD)
        gamificationTab.innerHTML = `
            <div style="background: #fff; padding: 20px; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); border-top: 5px solid #FFD700;">
                
                <div style="text-align: center; margin-bottom: 25px;">
                    <h3 style="margin:0; color: #333; font-size: 1.8em; text-transform: uppercase; letter-spacing: 2px;">🏆 Wall of Fame 🏆</h3>
                    <small style="color: #888;">Record assoluti dall'inizio della sagra</small>
                </div>
                
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 15px;">
                    
                    <!-- 1. Cassiere Flash -->
                    <div style="background: linear-gradient(135deg, #FFF9C4, #FFF59D); padding: 20px; border-radius: 12px; border: 2px solid #FBC02D; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                        <div style="font-size: 2.2em; margin-bottom: 5px;">⚡</div>
                        <h4 style="margin:0 0 8px 0; color: #F57F17; font-size: 1.1em;">Cassiere Flash</h4>
                        <div style="font-size: 1.3em; font-weight: bold; color: #333;">${bestCassiereTempo.nome}</div>
                        <small style="color: #666;">Media: ${formatTime(bestCassiereTempo.val)}</small>
                    </div>
                    
                    <!-- 2. Stacanovista -->
                    <div style="background: linear-gradient(135deg, #E1F5FE, #B3E5FC); padding: 20px; border-radius: 12px; border: 2px solid #03A9F4; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                        <div style="font-size: 2.2em; margin-bottom: 5px;">🏆</div>
                        <h4 style="margin:0 0 8px 0; color: #0277BD; font-size: 1.1em;">Lo Stacanovista</h4>
                        <div style="font-size: 1.3em; font-weight: bold; color: #333;">${bestCassiereOrdini.nome}</div>
                        <small style="color: #666;">${bestCassiereOrdini.val} ordini battuti</small>
                    </div>
                    
                    <!-- 3. Cassiere d'Oro -->
                    <div style="background: linear-gradient(135deg, #E8F5E9, #C8E6C9); padding: 20px; border-radius: 12px; border: 2px solid #4CAF50; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                        <div style="font-size: 2.2em; margin-bottom: 5px;">💰</div>
                        <h4 style="margin:0 0 8px 0; color: #2E7D32; font-size: 1.1em;">Cassiere d'Oro</h4>
                        <div style="font-size: 1.3em; font-weight: bold; color: #333;">${bestCassiereIncasso.nome}</div>
                        <small style="color: #666;">Incasso: €${bestCassiereIncasso.val.toFixed(2)}</small>
                    </div>

                    <!-- 4. Re della Spina -->
                    <div style="background: linear-gradient(135deg, #FFF3E0, #FFCC80); padding: 20px; border-radius: 12px; border: 2px solid #FF9800; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                        <div style="font-size: 2.2em; margin-bottom: 5px;">🍻</div>
                        <h4 style="margin:0 0 8px 0; color: #E65100; font-size: 1.1em;">Re della Spina</h4>
                        <div style="font-size: 1.3em; font-weight: bold; color: #333;">${bestCassiereBirre.nome}</div>
                        <small style="color: #666;">${bestCassiereBirre.val} birre vendute</small>
                    </div>

                    <!-- 5. Spillatura Record -->
                    <div style="background: linear-gradient(135deg, #FFECB3, #FFD54F); padding: 20px; border-radius: 12px; border: 2px solid #FFB300; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                        <div style="font-size: 2.2em; margin-bottom: 5px;">🍺</div>
                        <h4 style="margin:0 0 8px 0; color: #FF8F00; font-size: 1.1em;">Spillatura Record</h4>
                        <div style="font-size: 1.3em; font-weight: bold; color: #333;">${formatTime(fastestBeerTime)}</div>
                        <small style="color: #666;">Ordine birra più veloce</small>
                    </div>

                    <!-- 6. La Ferrari -->
                    <div style="background: linear-gradient(135deg, #FCE4EC, #F8BBD0); padding: 20px; border-radius: 12px; border: 2px solid #F06292; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                        <div style="font-size: 2.2em; margin-bottom: 5px;">👑</div>
                        <h4 style="margin:0 0 8px 0; color: #C2185B; font-size: 1.1em;">La Ferrari (Media)</h4>
                        <div style="font-size: 1.3em; font-weight: bold; color: #333;">${bestRepartoMedia.nome}</div>
                        <small style="color: #666;">Media generale: ${formatTime(bestRepartoMedia.val)}</small>
                    </div>

                    <!-- 7. Il Razzo -->
                    <div style="background: linear-gradient(135deg, #F3E5F5, #E1BEE7); padding: 20px; border-radius: 12px; border: 2px solid #BA68C8; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                        <div style="font-size: 2.2em; margin-bottom: 5px;">🚀</div>
                        <h4 style="margin:0 0 8px 0; color: #6A1B9A; font-size: 1.1em;">Il Razzo</h4>
                        <div style="font-size: 1.3em; font-weight: bold; color: #333;">${getNomeReparto(razzo.reparto)}</div>
                        <small style="color: #666;">${razzo.nomeOrdine} in <b>${formatTime(razzo.tempo)}</b></small>
                    </div>

                    <!-- 8. La Tartaruga -->
                    <div style="background: linear-gradient(135deg, #EFEBE9, #D7CCC8); padding: 20px; border-radius: 12px; border: 2px solid #8D6E63; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                        <div style="font-size: 2.2em; margin-bottom: 5px;">🐢</div>
                        <h4 style="margin:0 0 8px 0; color: #4E342E; font-size: 1.1em;">La Tartaruga</h4>
                        <div style="font-size: 1.3em; font-weight: bold; color: #333;">${getNomeReparto(tartaruga.reparto)}</div>
                        <small style="color: #666;">${tartaruga.nomeOrdine} in <b>${formatTime(tartaruga.tempo)}</b></small>
                    </div>

                    <!-- 9. Reparto On Fire -->
                    <div style="background: linear-gradient(135deg, #FFEBEE, #FFCDD2); padding: 20px; border-radius: 12px; border: 2px solid #E57373; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                        <div style="font-size: 2.2em; margin-bottom: 5px;">🔥</div>
                        <h4 style="margin:0 0 8px 0; color: #C62828; font-size: 1.1em;">Reparto On Fire</h4>
                        <div style="font-size: 1.3em; font-weight: bold; color: #333;">${getNomeReparto(onFire.reparto)}</div>
                        <small style="color: #666;"><b>${onFire.ordini}</b> ordini totali completati</small>
                    </div>

                    <!-- 10. Fame da Lupi -->
                    <div style="background: linear-gradient(135deg, #E0F7FA, #B2EBF2); padding: 20px; border-radius: 12px; border: 2px solid #4DD0E1; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                        <div style="font-size: 2.2em; margin-bottom: 5px;">🍕</div>
                        <h4 style="margin:0 0 8px 0; color: #00838F; font-size: 1.1em;">Fame da Lupi</h4>
                        <div style="font-size: 1.3em; font-weight: bold; color: #333;">${maxPiattiInOrdine} piatti</div>
                        <small style="color: #666;">Nella singola ${recordFameNome}</small>
                    </div>

                    <!-- 11. Scontrino d'Oro -->
                    <div style="background: linear-gradient(135deg, #E0F2F1, #80CBC4); padding: 20px; border-radius: 12px; border: 2px solid #009688; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                        <div style="font-size: 2.2em; margin-bottom: 5px;">🧾</div>
                        <h4 style="margin:0 0 8px 0; color: #00695C; font-size: 1.1em;">Scontrino d'Oro</h4>
                        <div style="font-size: 1.3em; font-weight: bold; color: #333;">€${scontrinoOro.importo.toFixed(2)}</div>
                        <small style="color: #666;">Nella singola ${scontrinoOro.nomeOrdine}</small>
                    </div>

                    <!-- 12. Macina-Piatti -->
                    <div style="background: linear-gradient(135deg, #FFF8E1, #FFE082); padding: 20px; border-radius: 12px; border: 2px solid #FFA000; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                        <div style="font-size: 2.2em; margin-bottom: 5px;">🍽️</div>
                        <h4 style="margin:0 0 8px 0; color: #FF8F00; font-size: 1.1em;">Macina-Piatti</h4>
                        <div style="font-size: 1.3em; font-weight: bold; color: #333;">${bestCassierePiatti.nome}</div>
                        <small style="color: #666;">${bestCassierePiatti.val} piatti venduti</small>
                    </div>
                    
                </div>
            </div>
        `;
        
        // Imposta l'auto-aggiornamento ogni 60 secondi
        if (window.gamificationInterval) clearInterval(window.gamificationInterval);
        window.gamificationInterval = setInterval(() => {
            if (gamificationTab.style.display !== "none") {
                window.caricaGamification();
            }
        }, 60000);
        
    } catch (err) {
        console.error("Errore caricamento gamification:", err);
    } finally {
        hideLoader();
    }
}
// -------------------- UTENTI --------------------
async function caricaUtenti(){
    if (!checkOnline(true)) return;
    showLoader();
    const div = document.getElementById("listaUtenti");
    if(!div) return;
    div.innerHTML = "";

    const categorie = ["admin", "cassa", "bere", "cucina"];
    
    // Usiamo le impostazioni in cache per leggere lo stato in modo istantaneo
    const snackAttivo = window.settings?.snackAbilitato === true;
    const extra1Attivo = window.settings?.extra1Abilitato === true;
    const extra2Attivo = window.settings?.extra2Abilitato === true;
    const extra3Attivo = window.settings?.extra3Abilitato === true;

    if (snackAttivo) categorie.push("snack");
    if (extra1Attivo) categorie.push("extra1");
    if (extra2Attivo) categorie.push("extra2");
    if (extra3Attivo) categorie.push("extra3");

    // Migra in automatico verso "Cucina" gli utenti dei reparti disabilitati
    db.ref("utenti").once("value").then(snapshot => {
        snapshot.forEach(snap => {
            const u = snap.val();
            if (!u) return;
            if (u.ruolo === "snack" && !snackAttivo) db.ref("utenti/" + snap.key).update({ ruolo: "cucina" });
            if (u.ruolo === "extra1" && !extra1Attivo) db.ref("utenti/" + snap.key).update({ ruolo: "cucina" });
            if (u.ruolo === "extra2" && !extra2Attivo) db.ref("utenti/" + snap.key).update({ ruolo: "cucina" });
            if (u.ruolo === "extra3" && !extra3Attivo) db.ref("utenti/" + snap.key).update({ ruolo: "cucina" });
        });
    });

    const categorieDiv = {};

    // Attesa: titolo + contenitore per gli utenti non approvati
    const attesaDiv = document.createElement("div");
    attesaDiv.style.display = "none"; // 🔥 NASCOSTO DI DEFAULT
    const hAttesa = document.createElement("h3");
    hAttesa.innerText = "⏳ Utenti in attesa di approvazione";
    hAttesa.style.color = "#E91E63";
    hAttesa.style.borderBottom = "2px solid #eee";
    hAttesa.style.paddingBottom = "5px";
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
        let nomeCat = cat.charAt(0).toUpperCase() + cat.slice(1);
        if (cat === "extra1") nomeCat = window.nomiRepartiExtra?.extra1 || "Extra 1";
        if (cat === "extra2") nomeCat = window.nomiRepartiExtra?.extra2 || "Extra 2";
        if (cat === "extra3") nomeCat = window.nomiRepartiExtra?.extra3 || "Extra 3";
        h.innerText = nomeCat;
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
		// AGGIUNGI QUESTO BLOCCO:
        if (!snap.exists() || snap.numChildren() === 1) { // === 1 per ignorare l'admin predefinito
             div.innerHTML = "<div style='text-align:center; padding: 30px; color: #777; font-style: italic; font-size: 1.1em;'>Sei l'unico sopravvissuto... o forse devi ancora invitare il resto della squadra! 🕵️‍♂️</div>";
             return;
        }

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
            if (snackAttivo) ruoliBase.push("snack");
            if (extra1Attivo) ruoliBase.push("extra1");
            if (extra2Attivo) ruoliBase.push("extra2");
            if (extra3Attivo) ruoliBase.push("extra3");

            ruoliBase.forEach(r => {
                const opt = document.createElement("option");
                opt.value = r;
                
                let labelRuolo = r === "--" ? "--" : r.charAt(0).toUpperCase() + r.slice(1);
                if (r === "extra1") labelRuolo = window.nomiRepartiExtra?.extra1 || "Extra 1";
                if (r === "extra2") labelRuolo = window.nomiRepartiExtra?.extra2 || "Extra 2";
                if (r === "extra3") labelRuolo = window.nomiRepartiExtra?.extra3 || "Extra 3";
                
                opt.innerText = labelRuolo;
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
		// 🔥 CONTROLLO: Se ci sono utenti in attesa, mostra il blocco, altrimenti nascondilo!
        if (attesaList.children.length > 0) {
            attesaDiv.style.display = "block";
        } else {
            attesaDiv.style.display = "none";
        }
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
		// Genera stringhe HTML dinamiche per le categorie EXTRA
    const nE1 = window.nomiRepartiExtra?.extra1 || "Extra 1";
    const nE2 = window.nomiRepartiExtra?.extra2 || "Extra 2";
    const nE3 = window.nomiRepartiExtra?.extra3 || "Extra 3";

    const optExtra1 = window.settings.extra1Abilitato ? `<option value="extra1">${nE1}</option>` : '';
    const optExtra2 = window.settings.extra2Abilitato ? `<option value="extra2">${nE2}</option>` : '';
    const optExtra3 = window.settings.extra3Abilitato ? `<option value="extra3">${nE3}</option>` : '';

    const chkExtra1 = window.settings.extra1Abilitato ? `<label style="margin-right:15px;"><input type="checkbox" class="mod-chk-cat" value="extra1"> ${nE1}</label>` : '';
    const chkExtra2 = window.settings.extra2Abilitato ? `<label style="margin-right:15px;"><input type="checkbox" class="mod-chk-cat" value="extra2"> ${nE2}</label>` : '';
    const chkExtra3 = window.settings.extra3Abilitato ? `<label><input type="checkbox" class="mod-chk-cat" value="extra3"> ${nE3}</label>` : '';
	
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
					    ${optExtra1} ${optExtra2} ${optExtra3}
                    </select>
	            </div>
	        </div>
	        <div style="margin-bottom: 15px;">
	            <label><b>Aggiunte max gratuite:</b></label>
	            <input type="number" id="modalPiattoMaxGratis" min="0" placeholder="0 (Nessuna gratuità)" style="width: 100%; padding: 8px; box-sizing: border-box; margin-top: 4px; border: 1px solid #ccc; border-radius: 4px;">
	        </div>
			<div style="margin-bottom: 15px;">
	            <label><b>Ingredienti / Ricetta Piatto:</b></label>
                <div id="modalPiattoIngredientiContainer" style="margin-top: 8px; max-height: 220px; overflow-y: auto; border: 1px solid #ccc; padding: 10px; border-radius: 6px; background: #fafafa;"></div>
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
        const categorie = { cibi: [], bevande: [], snack: [], extra1: [], extra2: [], extra3: [] };
// --- EMPTY STATE MENU ADMIN ---
            if (Object.keys(data).length === 0) {
                div.innerHTML = "<div style='text-align:center; padding: 30px; color: #777; font-style: italic; font-size: 1.1em;'>Il menu è tristemente vuoto. Aggiungi qualche prelibatezza! 🍔</div>";
                return;
            }

        for(let id in data){
            const piatto = data[id];
            if (!piatto || !piatto.categoria) continue;
            if(!categorie[piatto.categoria]) categorie[piatto.categoria] = [];
            categorie[piatto.categoria].push({id, ...piatto});
        }

        for(const cat of ["cibi","bevande","snack", "extra1", "extra2", "extra3"]){
            // 🔹 SE IL PROFILO E' SPENTO E NON HA PIATTI, NASCONDILO
            let abilita = true;
            if (cat === "snack") abilita = window.settings.snackAbilitato;
            if (cat.startsWith("extra")) abilita = window.settings[cat + "Abilitato"];
            
            if (!abilita && !window.categoriaHaPiatti(cat)) continue;

            const h = document.createElement("h4");
            let catTitle = cat.charAt(0).toUpperCase() + cat.slice(1);
            if (cat === "extra1") catTitle = window.nomiRepartiExtra?.extra1 || "Extra 1";
            if (cat === "extra2") catTitle = window.nomiRepartiExtra?.extra2 || "Extra 2";
            if (cat === "extra3") catTitle = window.nomiRepartiExtra?.extra3 || "Extra 3";
            h.innerText = catTitle;
            div.appendChild(h);

            if(categorie[cat].length === 0){
                const p = document.createElement("p");
                p.innerText = "Nessun piatto in questa categoria. 🍽️";
                p.style.fontStyle = "italic";
                p.style.color = "#777";
                p.style.textAlign = "center";
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
	// Genera stringhe HTML dinamiche per le categorie EXTRA
    const nE1 = window.nomiRepartiExtra?.extra1 || "Extra 1";
    const nE2 = window.nomiRepartiExtra?.extra2 || "Extra 2";
    const nE3 = window.nomiRepartiExtra?.extra3 || "Extra 3";

    const optExtra1 = window.settings.extra1Abilitato ? `<option value="extra1">${nE1}</option>` : '';
    const optExtra2 = window.settings.extra2Abilitato ? `<option value="extra2">${nE2}</option>` : '';
    const optExtra3 = window.settings.extra3Abilitato ? `<option value="extra3">${nE3}</option>` : '';

    const chkExtra1 = window.settings.extra1Abilitato ? `<label style="margin-right:15px;"><input type="checkbox" class="mod-chk-cat" value="extra1"> ${nE1}</label>` : '';
    const chkExtra2 = window.settings.extra2Abilitato ? `<label style="margin-right:15px;"><input type="checkbox" class="mod-chk-cat" value="extra2"> ${nE2}</label>` : '';
    const chkExtra3 = window.settings.extra3Abilitato ? `<label><input type="checkbox" class="mod-chk-cat" value="extra3"> ${nE3}</label>` : '';

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
                    ${optExtra1} ${optExtra2} ${optExtra3}
                </select>
            </div>
        </div>
        <div style="margin-bottom: 15px;">
            <label><b>Aggiunte max gratuite:</b></label>
            <input type="number" id="editPiattoMaxGratis" min="0" placeholder="0" style="width: 100%; padding: 8px; box-sizing: border-box; margin-top: 4px; border: 1px solid #ccc; border-radius: 4px;">
        </div>
		<div style="margin-bottom: 15px;">
            <label><b>Ingredienti / Composizione:</b></label>
            <div id="editPiattoIngredientiContainer" style="margin-top: 8px; max-height: 220px; overflow-y: auto; border: 1px solid #ccc; padding: 10px; border-radius: 6px; background: #fafafa;"></div>
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
// =========================================================================
// GESTIONE REPARTI EXTRA (1, 2, 3) CON POPUP E BLOCCO SICUREZZA
// =========================================================================

window.nomiRepartiExtra = { extra1: "", extra2: "", extra3: "" };

// 1. ASCOLTO NOMI IN TEMPO REALE DAL DATABASE
db.ref("impostazioni/nomiRepartiExtra").on("value", snap => {
    const dati = snap.val() || {};
    window.nomiRepartiExtra.extra1 = dati.extra1 || "";
    window.nomiRepartiExtra.extra2 = dati.extra2 || "";
    window.nomiRepartiExtra.extra3 = dati.extra3 || "";

    aggiornaUIExtra('extra1', window.nomiRepartiExtra.extra1);
    aggiornaUIExtra('extra2', window.nomiRepartiExtra.extra2);
    aggiornaUIExtra('extra3', window.nomiRepartiExtra.extra3);
});

// Funzione interna per sbloccare/bloccare i bottoni in base alla presenza del nome
function aggiornaUIExtra(ruolo, nomeCorrente) {
    const isConfigurato = nomeCorrente && nomeCorrente.trim() !== "";
    const num = ruolo.replace('extra', '');
    const testoTitolo = isConfigurato ? nomeCorrente : `Extra ${num} (Senza Nome)`;
    
    // Titoli
    const t = document.getElementById(`titoloExtra${num}`); if(t) t.innerText = testoTitolo;
    const l = document.getElementById(`labelToggleExtra${num}`); if(l) l.innerText = `Abilita ${testoTitolo}`;

    // Pulsante Simula
    const btnSimula = document.getElementById(`simulaExtra${num}Btn`);
    if (btnSimula) {
        btnSimula.disabled = !isConfigurato;
        btnSimula.style.opacity = isConfigurato ? "1" : "0.5";
        btnSimula.style.cursor = isConfigurato ? "pointer" : "not-allowed";
    }
    
    // Pulsante Abilita (ON/OFF)
    const btnAbilita = document.getElementById(`toggleExtra${num}Btn`);
    if (btnAbilita) {
        btnAbilita.disabled = !isConfigurato;
        btnAbilita.style.opacity = isConfigurato ? "1" : "0.5";
        btnAbilita.style.cursor = isConfigurato ? "pointer" : "not-allowed";
    }
}

// 2. POPUP MODIFICA NOME (STILE NATIVO BISTROBÒ)
window.modificaNomeExtra = function(ruolo) {
    const nomeAttuale = window.nomiRepartiExtra[ruolo] || "";
    const num = ruolo.replace('extra', '');

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "10005";

    const modal = document.createElement("div");
    modal.className = "modal-varianti";
    modal.innerHTML = `
        <h3>Imposta Nome Reparto</h3>
        <div style="margin-bottom:15px; text-align:left;">
            <label><b>Nuovo nome (es. Griglia, Dolci, Pizzeria):</b></label><br>
            <input type="text" id="inputModNomeExtra" value="${nomeAttuale}" placeholder="Nome del reparto..." style="width:100%; box-sizing:border-box; padding:10px; margin-top:8px; border-radius:6px; border:1px solid #ccc; font-size:1em;">
            <p style="color:#d32f2f; font-size:0.85em; margin-top:8px;"><i>⚠️ Lascia vuoto per resettarlo e disattivarlo.</i></p>
        </div>
        <div class="modal-actions" style="display:flex; justify-content:flex-end; gap:10px;">
            <button class="btn-chiudi" id="closeModNome">Annulla</button>
            <button class="btn-salva" id="saveModNome">Salva Nome</button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    document.getElementById("closeModNome").onclick = () => overlay.remove();
    
    document.getElementById("saveModNome").onclick = async () => {
        let nuovoNome = document.getElementById("inputModNomeExtra").value.trim();
        
        if (nuovoNome === "") {
            const puoDisattivare = await window.controlloSicurezzaDisattivazione(ruolo);
            if (!puoDisattivare) {
                overlay.remove(); 
                return;
            }
            // Forza lo spegnimento del reparto sul DB
            await db.ref(`impostazioni/${ruolo}`).set(false); 
        }
        
        // Salva il nuovo nome sul DB
        await db.ref(`impostazioni/nomiRepartiExtra/${ruolo}`).set(nuovoNome);
        overlay.remove();
        if(typeof notify === "function") notify("Nome reparto aggiornato!", "success");
    };
};

// 3. BLOCCO DI SICUREZZA PER DISATTIVAZIONE/RESET
window.controlloSicurezzaDisattivazione = async function(ruolo) {
    let elementi = 0;
    
    // Controlliamo il Menu
    const snapMenu = await db.ref("menu").once("value");
    snapMenu.forEach(child => { if (child.val().categoria === ruolo) elementi++; });
    
    // Controlliamo gli Ingredienti
    const snapIng = await db.ref("ingredienti").once("value");
    snapIng.forEach(child => { if (child.val().categoria === ruolo) elementi++; });
    
    if (elementi > 0) {
        const nomeRep = window.nomiRepartiExtra[ruolo] || ruolo;
        const msg = `Impossibile procedere! Il reparto "${nomeRep}" contiene ancora ${elementi} piatti o ingredienti assegnati. Spostali in un'altra categoria prima di resettarlo.`;
        
        if(typeof disonotify === "function") {
            disonotify(msg, { confirmText: "Ho capito", showCancel: false });
        } else {
            alert(msg);
        }
        return false;
    }
    return true;
};
// ================= LOGICA STATISTICHE (Affiancate) =================
document.addEventListener("DOMContentLoaded", () => {
    const filtroSelect = document.getElementById("filtroStatistiche");
    if(filtroSelect) {
        filtroSelect.addEventListener("change", caricaStatistiche);
    }
});

window.statisticheGlobale = {};
window.statisticheTurno = {};

// Funzione Helper per calcolare i totali senza dover duplicare il codice
// Funzione Helper per calcolare i totali senza dover duplicare il codice
function analizzaComande(comandeObj, fondoCassaTot) {
    let totaleComande = 0;
    let totaleIncasso = 0;
    let totalePos = 0;
    let totaleContanti = 0;
    let incassoAsporto = 0;
    let incassoPreordini = 0;
    let totaleComandePreordini = 0;
    let incassoSoloExtra = 0;
	let totaleTempoEvasione = 0;
    let comandeCompletateConTempo = 0;

    // Tiene traccia di soldi guadagnati SOLO da aggiunte/contorni
    const piattiMap = {};
    const ingrMap = {};
    const incassiIngredienti = {};
    const listaComande = [];

    for (const id in comandeObj) {
        const c = comandeObj[id];
        totaleComande++;
        let comandaEPreordine = c.preordine === true;
        if (comandaEPreordine) totaleComandePreordini++;

        // 1. Calcolo il totale BASE della comanda prima degli sconti globali
        let totaleComandaBase = 0;
        let piattiTemp = [];

        (c.piatti || []).forEach(p => {
            const q = Number(p.quantita || 0);
            const prezzoTot = calcolaPrezzoConSconto(p); // sconto singolo (del piatto) già applicato
            totaleComandaBase += prezzoTot;
            piattiTemp.push({ p, q, prezzoTot });
        });

        // 2. Calcolo il totale SCONTATO se c'è uno sconto globale
        let totaleComandaScontata = totaleComandaBase;

        if (c.scontoGlobale) {
            if (c.scontoGlobale.tipo === "gratis") {
                totaleComandaScontata = 0;
            } else if (c.scontoGlobale.tipo === "percentuale") {
                totaleComandaScontata = totaleComandaBase - (totaleComandaBase * c.scontoGlobale.valore / 100);
            } else if (c.scontoGlobale.tipo === "fisso") {
                totaleComandaScontata = totaleComandaBase - c.scontoGlobale.valore;
            }
            if (totaleComandaScontata < 0) totaleComandaScontata = 0;
        }

        // 3. Trovo il fattore di proporzione per ripartire lo sconto globale sui singoli piatti
        const fattoreSconto = totaleComandaBase > 0 ? (totaleComandaScontata / totaleComandaBase) : 0;

        // 4. Salvo le statistiche distribuendo proporzionalmente il peso dello sconto globale
        piattiTemp.forEach(({ p, q, prezzoTot }) => {
            const prezzoEffettivo = prezzoTot * fattoreSconto;

            // 🔥 FIX CALCOLO EXTRA:
            let veroExtraIngredienti = Number(p.extraPrezzo || 0);
            (p.contorniScelti || []).forEach(contorno => {
                veroExtraIngredienti -= Number(contorno.prezzoPagato || 0);
            });
            // Anche l'incasso extra viene proporzionalmente ridotto dallo sconto globale!
            const extraGenerato = Math.max(0, veroExtraIngredienti) * q * fattoreSconto;
            incassoSoloExtra += extraGenerato;

            if (!piattiMap[p.nome]) piattiMap[p.nome] = { quantita: 0, incasso: 0 };
            piattiMap[p.nome].quantita += q;
            piattiMap[p.nome].incasso += prezzoEffettivo; // <-- FIX: Ora usa il prezzo decurtato!

            // Calcolo ingredienti base (per la tabella Ingredienti x Utilizzo)
            (p.ingredienti || []).forEach(ing => {
                const qty = (Number(ing.qtyPerUnit) || 1) * q;
                ingrMap[ing.nome] = (ingrMap[ing.nome] || 0) + qty;
                // Anche l'incasso per ingrediente assorbe lo sconto globale
                incassiIngredienti[ing.nome] = (incassiIngredienti[ing.nome] || 0) + prezzoEffettivo;
            });

            // Aggiungiamo al conteggio ingredienti anche le "Aggiunte"
            (p.varianti || []).filter(v => v.tipo === "aggiunta").forEach(v => {
                const qty = (Number(v.qty) || 1) * q;
                ingrMap[v.nome] = (ingrMap[v.nome] || 0) + qty;
            });
        });

        // 5. Aggiorno i totali di cassa con il totale reale scontato
        if (c.metodoPagamento === "pos") totalePos += totaleComandaScontata;
        else totaleContanti += totaleComandaScontata;

        totaleIncasso += totaleComandaScontata;
        if (c.commento) incassoAsporto += totaleComandaScontata;
        if (comandaEPreordine) incassoPreordini += totaleComandaScontata;

        listaComande.push({
            id,
            numero: c.numero,
            lettera: c.lettera,
            totale: totaleComandaScontata,
            piatti: (c.piatti || []).map(p => p.quantita + "x " + p.nome).join(", "),
            data: c.data || c.ora || c.timestamp || "", // <-- FIX: recupera la data corretta
            isPreordine: comandaEPreordine
        });
		// --- CALCOLO TEMPO EVASIONE MEDIO COMANDA ---
        let maxFine = 0;
        let isFullyCompleted = true;
        let hasItemsGlobal = false;
        
        const repartiCheck = ["cucina", "bere", "snack", "extra1", "extra2", "extra3"];
        repartiCheck.forEach(r => {
            const statoKey = "stato" + r.charAt(0).toUpperCase() + r.slice(1);
            if (c[statoKey]) {
                hasItemsGlobal = true;
                if (c[statoKey] !== "completato") isFullyCompleted = false;
                if (c["timestampFine_" + r] > maxFine) maxFine = c["timestampFine_" + r];
            }
        });
        
        if (hasItemsGlobal && isFullyCompleted && maxFine > (c.timestamp || 0)) {
            const tempo = maxFine - c.timestamp;
            if (tempo > 0 && tempo < 86400000) { // Ignora anomalie superiori a 24h
                totaleTempoEvasione += tempo;
                comandeCompletateConTempo++;
            }
        }
    }

    const piattiByQuantita = Object.entries(piattiMap).sort((a,b) => b[1].quantita - a[1].quantita);
    const piattiByIncasso = Object.entries(piattiMap).sort((a,b) => b[1].incasso - a[1].incasso);
    const ingrByQuantita = Object.entries(ingrMap).sort((a,b) => b[1] - a[1]);
    const ingrIncassiArray = Object.entries(incassiIngredienti).map(([n,i]) => ({ nome: n, incasso: i }));
	// Calcolo media in secondi
    let mediaEvasioneSecondi = comandeCompletateConTempo > 0 ? (totaleTempoEvasione / comandeCompletateConTempo) / 1000 : 0;

    return {
        totaleComande,
        totaleIncasso,
        totalePos,
        totaleContanti,
        incassoAsporto,
        incassoPreordini,
        totaleComandePreordini,
        incassoSoloExtra,
        piattiByQuantita,
        piattiByIncasso,
        ingrByQuantita,
        ingrIncassiArray,
        listaComande,
        fondoCassa: fondoCassaTot,
        mediaEvasioneSecondi
    };
}

// Genera e inietta l'HTML per le statistiche (usato per entrambi i box)
function renderHtmlStatistiche(elementId, stats) {
    const contenuto = document.getElementById(elementId);
    if (!contenuto) return;

    const rows = stats.piattiByQuantita.map(([nome, v]) => 
        `<tr><td style="text-align:left; padding:8px;">${nome}</td><td style="text-align:center; padding:8px; font-weight:bold;">${v.quantita}</td><td style="text-align:right; padding:8px; color:#2e7d32;">€${v.incasso.toFixed(2)}</td></tr>`
    ).join("");

    contenuto.innerHTML = `
        <div style="font-size: 1.05em;">
            <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                <div style="flex:1;">
                    ${(() => {
                        let ritmoTesto = "--";
                        if (stats.mediaEvasioneSecondi > 0) {
                            const sec = Math.floor(stats.mediaEvasioneSecondi);
                            ritmoTesto = sec < 60 ? `${sec} sec` : `${Math.floor(sec/60)} min ${sec%60} sec`;
                        }
                        return `<p style="margin: 4px 0;"><b>Totale comande:</b> ${stats.totaleComande} <span style="color:#2196F3; font-weight:bold; margin-left:15px; border-left: 2px solid #ccc; padding-left: 10px;">⏱️ Media Evasione: ${ritmoTesto}</span></p>`;
                    })()}
                    <p style="margin: 4px 0;"><b>Fondo Cassa Base:</b> €${stats.fondoCassa.toFixed(2)}</p>
                    <p style="margin: 4px 0;"><b>POS:</b> €${stats.totalePos.toFixed(2)} | <b>Contanti:</b> €${stats.totaleContanti.toFixed(2)}</p>
                </div>
                <div style="flex:1; border-left: 2px solid #eee; padding-left: 15px; color: #555;">
                    <p style="margin: 4px 0;"><b>Incasso Asporto:</b> €${stats.incassoAsporto.toFixed(2)}</p>
                    <p style="margin: 4px 0;"><b>Incasso Preordini:</b> €${stats.incassoPreordini.toFixed(2)} (${stats.totaleComandePreordini} ord.)</p>
                    <p style="margin: 4px 0;"><b>Valore Extra/Contorni:</b> €${stats.incassoSoloExtra.toFixed(2)}</p>
                </div>
            </div>
            
            <div style="background: #f9f9f9; padding: 12px; border-radius: 8px; margin: 15px 0; border: 1px solid #ddd;">
                <p style="margin: 0 0 5px 0;"><b>CASSA (Fondo + Contanti):</b> <span style="color:green; font-weight:bold; font-size:1.1em;">€${(stats.fondoCassa + stats.totaleContanti).toFixed(2)}</span></p>
                <p style="margin: 0;"><b>GUADAGNO REALE:</b> <span style="color:blue; font-weight:bold; font-size:1.1em;">€${stats.totaleIncasso.toFixed(2)}</span></p>
            </div>
        </div>
        
        <table border="0" style="width:100%; border-collapse:collapse; margin-top:10px; font-size: 0.95em;">
            <thead>
                <tr style="border-bottom:2px solid #444; background: #f1f1f1;">
                    <th style="text-align:left; padding:8px; border-radius: 6px 0 0 6px;">Piatto</th>
                    <th style="text-align:center; padding:8px;">Qtà</th>
                    <th style="text-align:right; padding:8px; border-radius: 0 6px 6px 0;">Incasso</th>
                </tr>
            </thead>
            <tbody>
                ${rows.replace(/<\/tr>/g,"</tr><tr style='border-bottom:1px solid #eee;'></tr>")}
            </tbody>
        </table>
    `;
}
async function caricaStatistiche() {
    if (!checkOnline(true)) return;
	if (!firebase.auth().currentUser) return;
    showLoader();

    const filtroSelect = document.getElementById("filtroStatistiche");
    const filtroContainer = document.getElementById("filtroStatisticheContainer");
    const boxTurnoPreciso = document.getElementById("boxTurnoPreciso");
    const titoloTurnoPreciso = document.getElementById("titoloTurnoPreciso");
    
    try {
        const [snapComande, snapStorico, snapFondoCorrente] = await Promise.all([
            db.ref("comande").once("value"),
            db.ref("storico_giornate").once("value"),
            db.ref("impostazioni/fondoCassa").once("value")
        ]);

        const comandeCorrenti = snapComande.val() || {};
        const storicoGiornate = snapStorico.val() || {};
        const fondoCassaCorrente = parseFloat(snapFondoCorrente.val()) || 0;
        
        // 1. POPOLA TENDINA
        const currentVal = filtroSelect ? filtroSelect.value : "correnti";
        if (filtroSelect) {
            filtroSelect.innerHTML = `<option value="correnti">Turno Attuale (Non archiviate)</option>`;
            Object.keys(storicoGiornate).forEach(key => {
                const turno = storicoGiornate[key];
                const opt = document.createElement("option");
                opt.value = key;
                opt.innerText = `📦 ${turno.nome}`;
                if (key === currentVal) opt.selected = true;
                filtroSelect.appendChild(opt);
            });
        }

        // 2. MOSTRA/NASCONDI PANNELLI
        const sistemaGiornateAttivo = window.settings && window.settings.sistemaGiornateAbilitato;
        
        if (sistemaGiornateAttivo) {
            if(filtroContainer) filtroContainer.style.display = "flex";
            if(boxTurnoPreciso) boxTurnoPreciso.style.display = "block";
        } else {
            if(filtroContainer) filtroContainer.style.display = "none";
            if(boxTurnoPreciso) boxTurnoPreciso.style.display = "none";
        }

        // 3. CALCOLA GLOBALE (Correnti + Tutti gli Archivi)
        let comandeGlobale = { ...comandeCorrenti };
        let fondoGlobale = fondoCassaCorrente;
        Object.values(storicoGiornate).forEach(turno => {
            if (turno.comande) Object.assign(comandeGlobale, turno.comande);
            fondoGlobale += (parseFloat(turno.fondoCassa) || 0);
        });
        
        window.statisticheGlobale = analizzaComande(comandeGlobale, fondoGlobale);
        window.statisticheGlobale.titoloReport = "Totale Globale Sagra";
        renderHtmlStatistiche("contenutoStatisticheGlobale", window.statisticheGlobale);
        
        // AGGIUNTA GRAFICO GLOBALE
        window.generaGraficoFasceOrarie(Object.values(comandeGlobale), 'globale');

        // 4. CALCOLA TURNO SPECIFICO (Solo se il sistema a giornate è attivo)
        if (sistemaGiornateAttivo) {
            let comandeTurno = {};
            let fondoTurno = 0;
            let nomeReportTurno = "Turno Corrente";

            if (currentVal === "correnti") {
                comandeTurno = comandeCorrenti;
                fondoTurno = fondoCassaCorrente;
                nomeReportTurno = "Turno Attuale (Non archiviate)";
                if(titoloTurnoPreciso) titoloTurnoPreciso.innerHTML = "⏱️ Turno Attuale";
            } else {
                const turnoScelto = storicoGiornate[currentVal];
                if (turnoScelto) {
                    comandeTurno = turnoScelto.comande || {};
                    fondoTurno = parseFloat(turnoScelto.fondoCassa) || 0;
                    nomeReportTurno = `Archivio: ${turnoScelto.nome}`;
                    if(titoloTurnoPreciso) titoloTurnoPreciso.innerHTML = `📦 ${turnoScelto.nome}`;
                }
            }

            window.statisticheTurno = analizzaComande(comandeTurno, fondoTurno);
            window.statisticheTurno.titoloReport = nomeReportTurno;
            renderHtmlStatistiche("contenutoStatisticheTurno", window.statisticheTurno);
			window.generaGraficoFasceOrarie(Object.values(comandeTurno), 'turno');
        }

    } catch (error) {
        console.error(error);
        notify("Errore caricamento statistiche: " + error.message, "error");
    } finally {
        hideLoader();
    }
}

// Wrapper magico per indirizzare i PDF e gli Excel verso il blocco corretto
window.esportaStatistiche = function(tipo, formato) {
    if (tipo === 'globale') {
        window.statistiche = window.statisticheGlobale;
        window.statistiche.tipoEsportazione = 'globale'; // SALVIAMO IL TIPO PER EXCEL E PDF
    } else {
        window.statistiche = window.statisticheTurno;
        window.statistiche.tipoEsportazione = 'turno'; // SALVIAMO IL TIPO PER EXCEL E PDF
    }
    if (formato === 'excel' && typeof generaExcel === 'function') generaExcel();
    else if (formato === 'pdf' && typeof generaPdf === 'function') generaPdf();
};
// --- EXCEL PDF ---
async function generaExcel() {
    if (!checkOnline(true)) return;
  const s = window.statistiche;
  if (!s) { notify("Nessuna statistica disponibile","warn"); return; }

 const { 
    piattiByIncasso, piattiByQuantita, ingrByQuantita, 
    totaleComande, totaleIncasso, totalePos, totaleContanti, 
    incassoAsporto, incassoPreordini, totaleComandePreordini, incassoSoloExtra, fondoCassa 
 } = s;
 
  const workbook = new ExcelJS.Workbook();

  // ----------------- Scheda 1: Piatti x Incasso -----------------
  const sheet1 = workbook.addWorksheet("Piatti x Incasso");
  sheet1.columns = [
    { header: "Piatto", key: "nome", width: 30 },
    { header: "Quantità", key: "quantita", width: 15 },
    { header: "Incasso", key: "incasso", width: 15 }
  ];

  sheet1.getRow(1).eachCell(cell => {
    cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFF00'} };
    cell.font = { bold:true };
  });

  piattiByIncasso.forEach(p => {
    const row = sheet1.addRow({ nome: p[0], quantita: p[1].quantita, incasso: Number(p[1].incasso.toFixed(2)) });
    row.getCell('C').numFmt = '€#,##0.00';
  });

  // --- Totali in colonna E/F ---
  sheet1.getCell('E2').value = "Numero totale comande";
  sheet1.getCell('F2').value = totaleComande;
  sheet1.getCell('E3').value = "Fondo Cassa Iniziale (€)";
  sheet1.getCell('F3').value = fondoCassa || 0;
  sheet1.getCell('E4').value = "Incasso POS (€)";
  sheet1.getCell('F4').value = totalePos;
  sheet1.getCell('E5').value = "Incasso Contanti (€)";
  sheet1.getCell('F5').value = totaleContanti;
  
  sheet1.getCell('E7').value = "Incasso Asporto (€)";
  sheet1.getCell('F7').value = incassoAsporto;
  sheet1.getCell('E8').value = "Incasso Preordini (€)";
  sheet1.getCell('F8').value = incassoPreordini;
  sheet1.getCell('E9').value = "N° Ordini Preordini";
  sheet1.getCell('F9').value = totaleComandePreordini;
  sheet1.getCell('E10').value = "Incasso Extra/Varianti (€)";
  sheet1.getCell('F10').value = incassoSoloExtra;

  sheet1.getCell('E12').value = "SOLDI TOTALI IN CASSA (€)";
  sheet1.getCell('F12').value = (fondoCassa || 0) + totaleContanti;
  sheet1.getCell('E13').value = "GUADAGNO REALE (€)";
  sheet1.getCell('F13').value = totaleIncasso;

  // Formatta valute
  ['F3','F4','F5','F7','F8','F10','F12','F13'].forEach(addr => {
      sheet1.getCell(addr).numFmt = '€#,##0.00';
  });

  // Stile totale base
  ['E2','F2','E3','F3','E4','F4','E5','F5'].forEach(addr => {
      const cell = sheet1.getCell(addr);
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'E0E0E0'} };
      cell.font = { bold:true };
  });

  // Stile totale Asporto/Preordini/Extra
  ['E7','F7','E8','F8','E9','F9','E10','F10'].forEach(addr => {
      const cell = sheet1.getCell(addr);
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFF2CC'} };
      cell.font = { bold:false };
  });

  // Stile finali
  ['E12','F12','E13','F13'].forEach(addr => {
      const cell = sheet1.getCell(addr);
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'00B0F0'} };
      cell.font = { bold:true, color:{argb:'FFFFFF'} };
  });

  sheet1.getColumn(5).width = 30; 
  sheet1.getColumn(6).width = 15;

  // ----------------- Scheda 2: Piatti x Quantità -----------------
  const sheet2 = workbook.addWorksheet("Piatti x Quantità");
  sheet2.columns = [
    { header: "Piatto", key: "nome", width: 30 },
    { header: "Quantità", key: "quantita", width: 15 },
    { header: "Incasso", key: "incasso", width: 15 }
  ];

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

  sheet3.getRow(1).eachCell(cell => {
    cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFF00'} };
    cell.font = { bold:true };
  });

  ingrByQuantita.forEach(p => sheet3.addRow({ nome: p[0], quantita: p[1] }));

  // ----------------- Scheda 4: Fasce Orarie -----------------
  const datiFasce = window[`datiFasce_${s.tipoEsportazione}`];
  if (datiFasce) {
      const sheet4 = workbook.addWorksheet("Fasce Orarie");
      
      // Costruisci le intestazioni dinamicamente in base alle impostazioni
      const intestazioni = ['Fascia Oraria', 'Cucina (pz)', 'Bere (pz)'];
      if (window.settings && window.settings.snackAbilitato) intestazioni.push('Snack (pz)');
      if (window.settings && window.settings.extra1Abilitato) intestazioni.push(`${window.nomiRepartiExtra?.extra1 || 'Extra 1'} (pz)`);
      if (window.settings && window.settings.extra2Abilitato) intestazioni.push(`${window.nomiRepartiExtra?.extra2 || 'Extra 2'} (pz)`);
      if (window.settings && window.settings.extra3Abilitato) intestazioni.push(`${window.nomiRepartiExtra?.extra3 || 'Extra 3'} (pz)`);
      intestazioni.push('Totale Piatti', 'Prodotto più venduto');

      sheet4.addRow(intestazioni);
      
      sheet4.getRow(1).eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF00' } };
          cell.font = { bold: true };
      });

      const orari = Object.keys(datiFasce).sort((a, b) => parseInt(a) - parseInt(b));
      orari.forEach(ora => {
          const d = datiFasce[ora];
          const topPiatto = Object.keys(d.prodotti).reduce((a, b) => d.prodotti[a] > d.prodotti[b] ? a : b, "");
          const nomeVincitore = topPiatto ? `${topPiatto} (${d.prodotti[topPiatto]})` : '';
          
          // Costruisci la riga dati dinamicamente
          const rigaDati = [ora, d.cibo, d.bere];
          if (window.settings && window.settings.snackAbilitato) rigaDati.push(d.snack);
          if (window.settings && window.settings.extra1Abilitato) rigaDati.push(d.extra1);
          if (window.settings && window.settings.extra2Abilitato) rigaDati.push(d.extra2);
          if (window.settings && window.settings.extra3Abilitato) rigaDati.push(d.extra3);
          rigaDati.push(d.totale, nomeVincitore);

          sheet4.addRow(rigaDati);
      });
      sheet4.columns.forEach(column => { column.width = 18; });
  }

  // ----------------- Salva file -----------------
  const buf = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Statistiche_Incassi_${s.titoloReport.replace(/[^a-z0-9]/gi, '_')}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
function generaPdf() {
    if (!checkOnline(true)) return;
  const s = window.statistiche;
  if (!s) { notify("Nessuna statistica disponibile. Apri la tab Incassi prima.","warn"); return; }

  const { 
    totaleComande, totaleIncasso, totalePos, totaleContanti, incassoAsporto, 
    incassoPreordini, totaleComandePreordini, incassoSoloExtra, fondoCassa,
    piattiByQuantita, piattiByIncasso, ingrByQuantita, listaComande, titoloReport
  } = s;
  
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
  doc.setTextColor(0,0,200);
  doc.text(`Report Incassi: ${titoloReport || "Globale"}`, xLeft, y);
  y += 8;

  // Totali
  doc.setFontSize(12);
  doc.setFont(undefined,'normal');
  doc.setTextColor(0,0,0);
  doc.text(`Numero totale comande: ${totaleComande}`, xLeft, y);
  doc.text(`Fondo Cassa Iniziale: €${(fondoCassa || 0).toFixed(2)}`, xCenter, y);
  y += 6;
  doc.text(`Incasso POS: €${totalePos.toFixed(2)}`, xLeft, y);
  doc.text(`Incasso Contanti: €${totaleContanti.toFixed(2)}`, xCenter, y);
  y += 8;

  // Sezione Asporto/Preordini/Extra
  doc.setFontSize(10);
  doc.setTextColor(80,80,80);
  doc.text(`• Di cui Asporto: €${incassoAsporto.toFixed(2)}`, xLeft, y);
  y += 5;
  doc.text(`• Di cui Preordini: €${incassoPreordini.toFixed(2)} (${totaleComandePreordini} ordini)`, xLeft, y);
  y += 5;
  doc.text(`• Valore generato solo da Extra/Varianti: €${incassoSoloExtra.toFixed(2)}`, xLeft, y);
  y += 10;
  
  // Scritte in grassetto per i conti finali
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(0, 100, 0); // Verde scuro
  doc.text(`SOLDI TOTALI IN CASSA (Fondo + Contanti): €${((fondoCassa || 0) + totaleContanti).toFixed(2)}`, xLeft, y);
  y += 8;
  doc.setTextColor(0, 0, 255); // Blu
  doc.text(`GUADAGNO REALE (tolto fondo cassa): €${totaleIncasso.toFixed(2)}`, xLeft, y);
  y += 12;
  
  // Resetta colore e font per le tabelle
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
  doc.setTextColor(0,0,0);
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
  if (y > 260) { doc.addPage(); y = 20; }
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
  if (y > 260) { doc.addPage(); y = 20; }
  doc.setFontSize(13);
  doc.setFont(undefined,'bold');
  doc.setTextColor(0,100,0); // verde
  doc.text("Ingredienti — per utilizzo (Inclusi Extra)", xLeft, y);
  y += 6;
  doc.setFontSize(11);
  doc.setFont(undefined,'normal');
  doc.setTextColor(0,0,0); // dati in nero
  doc.text("Ingrediente", xLeft, y);
  doc.text("Quantità Usata", xRight, y, { align: "right" });
  y += 6;

  ingrByQuantita.forEach(([nome, qty]) => {
    if (y > 275) { doc.addPage(); y = 20; }
    doc.text(String(nome), xLeft, y);
    doc.text(String(qty), xRight, y, { align: "right" });
    y += 6;
  });

  // Lista Comande cronologica
  y += 8;
  if (y > 260) { doc.addPage(); y = 20; }
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

    const ts = c.timestamp || 0;
    const date = ts ? new Date(ts) : null;
    const dateStr = date ? `${date.getDate().toString().padStart(2,'0')}/${(date.getMonth()+1).toString().padStart(2,'0')} ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}` : "";

    if(c.id === maxComanda.id){
      doc.setFont(undefined,'bold');
      doc.setTextColor(255,150,0); // arancio per massimo incasso
    } else {
      doc.setFont(undefined,'normal');
      doc.setTextColor(0,0,0);
    }
    
    let testoNum = String(c.numero || "");
    if(c.isPreordine) testoNum += " (PRE)"; // Aggiunge piccola etichetta ai preordini

    doc.text(dateStr, xLeft, y); 
    doc.text(testoNum, xCenter, y, {align:"center"});
    doc.text(`€${c.totale.toFixed(2)}`, xRight, y, {align:"right"});
    y += 6;
  });

  // Aggiunta Fasce Orarie al PDF
  const datiFasce = window[`datiFasce_${s.tipoEsportazione}`];
  if (datiFasce) {
      y += 8;
      if (y > 260) { doc.addPage(); y = 20; }
      doc.setFontSize(13);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(0, 100, 0);
      doc.text("Flusso Vendite per Fascia Oraria", xLeft, y);
      y += 6;

      // Generazione dinamica della stringa delle intestazioni reparti
      let repStr = "Cucina | Bere";
      if (window.settings && window.settings.snackAbilitato) repStr += " | Snack";
      if (window.settings && window.settings.extra1Abilitato) repStr += ` | ${window.nomiRepartiExtra?.extra1 || 'Ex1'}`;
      if (window.settings && window.settings.extra2Abilitato) repStr += ` | ${window.nomiRepartiExtra?.extra2 || 'Ex2'}`;
      if (window.settings && window.settings.extra3Abilitato) repStr += ` | ${window.nomiRepartiExtra?.extra3 || 'Ex3'}`;

      doc.setFontSize(10); // Più piccolo perché la stringa può essere lunga
      doc.setFont(undefined, 'normal');
      doc.setTextColor(0, 0, 0);
      doc.text("Fascia", xLeft, y);
      doc.text(repStr, xCenter, y, { align: "center" });
      doc.text("Top Prodotto", xRight, y, { align: "right" });
      y += 6;

      const orari = Object.keys(datiFasce).sort((a, b) => parseInt(a) - parseInt(b));
      orari.forEach(ora => {
          if (y > 275) { doc.addPage(); y = 20; }
          const d = datiFasce[ora];
          const topPiatto = Object.keys(d.prodotti).reduce((a, b) => d.prodotti[a] > d.prodotti[b] ? a : b, "");
          
          // Generazione dinamica dei valori dei reparti
          let pzStr = `${d.cibo} | ${d.bere}`;
          if (window.settings && window.settings.snackAbilitato) pzStr += ` | ${d.snack}`;
          if (window.settings && window.settings.extra1Abilitato) pzStr += ` | ${d.extra1}`;
          if (window.settings && window.settings.extra2Abilitato) pzStr += ` | ${d.extra2}`;
          if (window.settings && window.settings.extra3Abilitato) pzStr += ` | ${d.extra3}`;
          
          doc.text(String(ora), xLeft, y);
          doc.text(pzStr, xCenter, y, { align: "center" });
          doc.text(String(topPiatto ? `${topPiatto} (${d.prodotti[topPiatto]})` : "—"), xRight, y, { align: "right" });
          y += 6;
      });
  }

  doc.save(`Statistiche_Incassi_${titoloReport.replace(/[^a-z0-9]/gi, '_')}.pdf`);
}
// ================= GRAFICI FASCE ORARIE (CHART.JS) =================
let istanzaGraficoTurno = null;
let istanzaGraficoGlobale = null;

window.generaGraficoFasceOrarie = function(comandeArray, tipo) {
    if (!comandeArray || comandeArray.length === 0) return;

    const fasce = {};

    comandeArray.forEach(c => {
        const ts = c.timestamp || c.data || c.ora;
        if (!ts) return;

        const ora = new Date(ts).getHours();
        const labelFascia = `${ora}:00 - ${ora + 1}:00`;

        if (!fasce[labelFascia]) {
            fasce[labelFascia] = { 
                cibo: 0, bere: 0, snack: 0, 
                extra1: 0, extra2: 0, extra3: 0, 
                prodotti: {}, totale: 0 
            };
        }

        if (c.piatti) {
            c.piatti.forEach(p => {
				if ((p.categoria || "").toLowerCase().trim() === "servizio" || p.nome === "Costo Asporto" || p.nome === "Coperto") return;
                const qty = p.quantita || 1;
                let cat = (p.categoria || "cibi").toLowerCase().trim();
                
                // Normalizza le categorie per leggere Risto o nomi personalizzati
                const lE1 = (window.nomiRepartiExtra?.extra1 || "").toLowerCase().trim();
                const lE2 = (window.nomiRepartiExtra?.extra2 || "").toLowerCase().trim();
                const lE3 = (window.nomiRepartiExtra?.extra3 || "").toLowerCase().trim();
                
                if (cat === "extra1" || cat === "risto" || (lE1 && cat === lE1)) cat = "extra1";
                else if (cat === "extra2" || (lE2 && cat === lE2)) cat = "extra2";
                else if (cat === "extra3" || (lE3 && cat === lE3)) cat = "extra3";

                // Smistamento per tutti i profili
                if (cat === "bevande") fasce[labelFascia].bere += qty;
                else if (cat === "snack" || cat.includes("fritti")) fasce[labelFascia].snack += qty;
                else if (cat === "extra1") fasce[labelFascia].extra1 += qty;
                else if (cat === "extra2") fasce[labelFascia].extra2 += qty;
                else if (cat === "extra3") fasce[labelFascia].extra3 += qty;
                else fasce[labelFascia].cibo += qty; 

                fasce[labelFascia].totale += qty;

                // Contatore top prodotti
                if (!fasce[labelFascia].prodotti[p.nome]) fasce[labelFascia].prodotti[p.nome] = 0;
                fasce[labelFascia].prodotti[p.nome] += qty;
            });
        }
    });

    const labelsOrdinate = Object.keys(fasce).sort((a, b) => parseInt(a) - parseInt(b));
    const datiCibo = []; const datiBere = []; const datiSnack = [];
    const datiExtra1 = []; const datiExtra2 = []; const datiExtra3 = [];
    let testoTopProdotti = "<b>🔥 Top Prodotto per Fascia Oraria:</b><br>";

    labelsOrdinate.forEach(label => {
        const d = fasce[label];
        datiCibo.push(d.cibo);
        datiBere.push(d.bere);
        datiSnack.push(d.snack);
        datiExtra1.push(d.extra1);
        datiExtra2.push(d.extra2);
        datiExtra3.push(d.extra3);

        const topPiatto = Object.keys(d.prodotti).reduce((a, b) => d.prodotti[a] > d.prodotti[b] ? a : b, "");
        if (topPiatto) {
            testoTopProdotti += `<span style="display:inline-block; margin: 2px 10px; background: rgba(33, 150, 243, 0.1); padding: 2px 8px; border-radius: 4px; border: 1px solid rgba(33, 150, 243, 0.3);"><b>${label}</b>: ${topPiatto} (${d.prodotti[topPiatto]} pz)</span>`;
        }
    });

    const divTopProdotti = document.getElementById(tipo === 'turno' ? 'topProdottiTurno' : 'topProdottiGlobale');
    if (divTopProdotti) divTopProdotti.innerHTML = testoTopProdotti;

    // --- COSTRUZIONE DINAMICA DEI REPARTI SUL GRAFICO ---
    const datasetsToUse = [
        { label: 'Cucina', data: datiCibo, backgroundColor: '#FF9800' },
        { label: 'Bere', data: datiBere, backgroundColor: '#2196F3' }
    ];
    if (window.settings && window.settings.snackAbilitato) {
        datasetsToUse.push({ label: 'Snack/Fritti', data: datiSnack, backgroundColor: '#FFC107' });
    }
    if (window.settings && window.settings.extra1Abilitato) {
        datasetsToUse.push({ label: window.nomiRepartiExtra?.extra1 || 'Extra 1', data: datiExtra1, backgroundColor: '#9C27B0' });
    }
    if (window.settings && window.settings.extra2Abilitato) {
        datasetsToUse.push({ label: window.nomiRepartiExtra?.extra2 || 'Extra 2', data: datiExtra2, backgroundColor: '#4CAF50' });
    }
    if (window.settings && window.settings.extra3Abilitato) {
        datasetsToUse.push({ label: window.nomiRepartiExtra?.extra3 || 'Extra 3', data: datiExtra3, backgroundColor: '#F44336' });
    }

    // --- RICONOSCIMENTO TEMA PER TESTI E GRIGLIA ---
    const isDarkTheme = document.body.classList.contains('tema-notte') || document.body.classList.contains('tema-astronave');
    const chartTextColor = isDarkTheme ? '#E2E8F0' : '#666666';
    const chartGridColor = isDarkTheme ? '#334155' : '#E0E0E0';

    const canvasId = tipo === 'turno' ? 'graficoTurnoCanvas' : 'graficoGlobaleCanvas';
    const canvasEl = document.getElementById(canvasId);
    if (!canvasEl) return;
    const ctx = canvasEl.getContext('2d');

    if (tipo === 'turno' && istanzaGraficoTurno) istanzaGraficoTurno.destroy();
    if (tipo === 'globale' && istanzaGraficoGlobale) istanzaGraficoGlobale.destroy();

    const chartConfig = {
        type: 'bar',
        data: {
            labels: labelsOrdinate,
            datasets: datasetsToUse
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            color: chartTextColor, // Colore testo legenda
            scales: {
                x: { 
                    stacked: true,
                    ticks: { color: chartTextColor },
                    grid: { color: chartGridColor }
                },
                y: { 
                    stacked: true, 
                    beginAtZero: true, 
                    ticks: { precision: 0, color: chartTextColor },
                    grid: { color: chartGridColor }
                }
            },
            plugins: { 
                legend: { 
                    position: 'bottom',
                    labels: { color: chartTextColor }
                } 
            }
        }
    };

    if (tipo === 'turno') istanzaGraficoTurno = new Chart(ctx, chartConfig);
    else istanzaGraficoGlobale = new Chart(ctx, chartConfig);

    window[`datiFasce_${tipo}`] = fasce;
};
// -------------------- SCONTI ADMIN --------------------
function caricaScontiAdmin() {
    if (!checkOnline(true)) return;
    const div = document.getElementById("listaSconti");
    div.innerHTML = "";

    db.ref("menu").once("value").then(snap => {
        const data = snap.val() || {};
        if (Object.keys(data).length === 0) {
            div.innerHTML = "<div style='text-align:center; padding: 30px; color: #777; font-style: italic; font-size: 1.1em;'>Nessun piatto, nessuno sconto. Prima cucina, poi pensa ai saldi! 💸</div>";
            return;
        }
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
// ================= GESTIONE TASTI COPERTO E ASPORTO =================
document.addEventListener("DOMContentLoaded", () => {
    // --- FUNZIONAMENTO TASTO COPERTO ---
    const btnCoperto = document.getElementById("btnCopertoCassa");
    if (btnCoperto) {
        btnCoperto.addEventListener("click", () => {
            // Funzione interna per iniettare i coperti
            const aggiungiCopertoAComanda = (q) => {
                const esiste = comandaCorrente.find(i => i.nome === "Coperto");
                if (esiste) {
                    esiste.quantita += q;
                } else {
                    comandaCorrente.push({
                        nome: "Coperto",
                        prezzo: window.settings.copertoValore || 0,
                        quantita: q,
                        categoria: "servizio" // NON STAMPA IN CUCINA
                    });
                }
                if (typeof aggiornaComandaCorrente === "function") aggiornaComandaCorrente();
            };

            // Se è attivo il tastierino legge la quantità, altrimenti apre il POPUP
            if (window.settings.selettoreQuantitaCassa) {
                const quantVal = document.getElementById("quantita").value;
                const quant = parseInt(quantVal);
                if (!quant || quant <= 0) { 
                    notify("Seleziona la quantità di coperti dal tastierino!", "warn"); 
                    return; 
                }
                aggiungiCopertoAComanda(quant);
            } else {
                // APRE IL POPUP CUSTOM INVECE DEL PROMPT
                chiediValoreConPopup("🍽️ Aggiungi Coperti", "Quanti coperti vuoi aggiungere?", "1", (res) => {
                    if (res !== null) {
                        const quant = parseInt(res);
                        if (!isNaN(quant) && quant > 0) {
                            aggiungiCopertoAComanda(quant);
                        }
                    }
                });
            }
        });
    }

    // --- FUNZIONAMENTO AUTOMATICO COSTO ASPORTO ---
    const asportoCheckElem = document.getElementById("checkAsporto");
    if (asportoCheckElem) {
        asportoCheckElem.addEventListener("change", (e) => {
            if (window.settings.costoAsportoAbilitato) {
                const fee = window.settings.costoAsportoValore || 0;
                if (e.target.checked) {
                    if (fee > 0 && !comandaCorrente.find(i => i.nome === "Costo Asporto")) {
                        comandaCorrente.push({
                            nome: "Costo Asporto",
                            prezzo: fee,
                            quantita: 1,
                            categoria: "servizio" // 🔹 FONDAMENTALE: "servizio" viene stampato solo al cliente!
                        });
                    }
                } else {
                    // Se disattivi la spunta, lo rimuove in automatico
                    comandaCorrente = comandaCorrente.filter(i => i.nome !== "Costo Asporto");
                }
                if (typeof aggiornaComandaCorrente === "function") aggiornaComandaCorrente();
            }
        });
    }
});
// ================= SISTEMA ANNULLAMENTO ULTIMA VENDITA =================
let timerAnnullamentoInterval = null;

window.avviaTimerAnnullamento = function(idComanda, datiComanda) {
    const btn = document.getElementById("annullaUltimaVenditaBtn");
    const spanTimer = document.getElementById("timerAnnullamento");
    if (!btn || !spanTimer) return;

    // Resetta eventuale timer precedente
    clearInterval(timerAnnullamentoInterval);
    
    let secondiRimasti = window.settings.tempoAnnullamento || 30;
    
    // Mostra il pulsante con l'animazione pulsante morbida
    btn.style.display = "inline-block";
    btn.style.animation = "pulse 1.5s infinite alternate";
    spanTimer.innerText = secondiRimasti;

    window.ultimaComandaDaAnnullare = { id: idComanda, dati: datiComanda };

    // Timer decrescente
    timerAnnullamentoInterval = setInterval(() => {
        secondiRimasti--;
        spanTimer.innerText = secondiRimasti;
        
        // Se mancano 5 secondi, inizia a lampeggiare furiosamente per allertare il cassiere
        if (secondiRimasti <= 5) {
            btn.style.animation = "blinkalert 0.4s infinite"; 
        }
        
        // Fine tempo
        if (secondiRimasti <= 0) {
            clearInterval(timerAnnullamentoInterval);
            btn.style.display = "none";
            btn.style.animation = "";
            window.ultimaComandaDaAnnullare = null;
        }
    }, 1000);
    
    // Azione al Click
    btn.onclick = async () => {
        clearInterval(timerAnnullamentoInterval);
        btn.style.display = "none";
        btn.style.animation = "";
        
        if (!window.ultimaComandaDaAnnullare) return;
        const id = window.ultimaComandaDaAnnullare.id;
        const c = window.ultimaComandaDaAnnullare.dati;
        window.ultimaComandaDaAnnullare = null;
        
        showLoader();
        try {
            // 1. RIPRISTINA GLI INGREDIENTI (Ripercorre la logica intelligente di scalo e inverte il processo)
            const richieste = calcolaRichiesteDaPiatti(c.piatti || []);
            const jobs = [];
            const ingData = window.ingredientData || {};
            
            for (const idIng in richieste.byId) {
                jobs.push({ id: idIng, need: richieste.byId[idIng] });
            }
            for (const nameLow in richieste.byName) {
                const mapped = Object.keys(ingData).find(k => (ingData[k].nome||"").trim().toLowerCase() === nameLow);
                if (mapped) {
                    const existing = jobs.find(j => j.id === mapped);
                    if (existing) existing.need += richieste.byName[nameLow]; 
                    else jobs.push({ id: mapped, need: richieste.byName[nameLow] });
                }
            }
            
            for (const j of jobs) {
                await applicaIncrementoSingolo(j.id, j.need);
            }
            
            // 2. ELIMINA LA COMANDA DEFINITIVAMENTE
            await db.ref("comande/" + id).remove();

            // ---> INIZIO INSERIMENTO ROLLBACK CONTATORE <---
            if (window.settings.comandeProgressive) {
                const contatoreRef = db.ref("impostazioni/contatoreComande");
                await contatoreRef.transaction(valoreCorrente => {
                    // Se il contatore esiste ed è maggiore di 0, scala di 1
                    if (valoreCorrente && valoreCorrente > 0) {
                        return valoreCorrente - 1;
                    }
                    return valoreCorrente; 
                });
            }
            // ---> FINE INSERIMENTO ROLLBACK CONTATORE <---

            // 3. RIPRISTINA IL CARRELLO A SCHERMO (Cosa utilissima se c'era solo un errore al volo)
            
            // 3. RIPRISTINA IL CARRELLO A SCHERMO (Cosa utilissima se c'era solo un errore al volo)
            comandaCorrente = c.piatti || [];
            aggiornaComandaCorrente();
            
            notify("✅ Ultima vendita annullata! Carrello e ingredienti ripristinati.", "success");
            
        } catch (err) {
            console.error("Errore annullamento:", err);
            notify("❌ Errore annullamento: " + err.message, "error");
        } finally {
            hideLoader();
        }
    };
};
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
		    const tickExtra1 = document.getElementById("tickExtra1");
		    const tickExtra2 = document.getElementById("tickExtra2");
		    const tickExtra3 = document.getElementById("tickExtra3");
		    
		    const cucinaSel = tickCucina && tickCucina.checked;
		    const bereSel = tickBere && tickBere.checked;
		    const snackSel = tickSnack && tickSnack.checked;
		    const extra1Sel = tickExtra1 && tickExtra1.checked;
		    const extra2Sel = tickExtra2 && tickExtra2.checked;
		    const extra3Sel = tickExtra3 && tickExtra3.checked;
		
		    if (!cucinaSel && !bereSel && !snackSel && !extra1Sel && !extra2Sel && !extra3Sel) {
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

            // --- 6. COSTRUZIONE OGGETTO COMANDA (MANTENUTO E MIGLIORATO) ---
			const orario = new Date().toLocaleTimeString("it-IT", { hour12: false });
			const ref = db.ref("comande").push();
			
			// 🔹 FIX ANTI-CRASH: Assegniamo " = []" in fase di destrutturazione. 
			// Se una categoria manca o è vuota, JS le assegnerà forzatamente un array vuoto, evitando l'errore .length.
			const { 
			    cibo = [], 
			    bere = [], 
			    snack = [], 
			    extra1 = [], 
			    extra2 = [], 
			    extra3 = [] 
			} = separaComanda(piattiValidi || []);
			
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
				if (document.getElementById("tickExtra1") && document.getElementById("tickExtra1").checked) noteDestinazioni.push("extra1");
				if (document.getElementById("tickExtra2") && document.getElementById("tickExtra2").checked) noteDestinazioni.push("extra2");
				if (document.getElementById("tickExtra3") && document.getElementById("tickExtra3").checked) noteDestinazioni.push("extra3");
			} else {
				noteDestinazioni = ["cucina"];
				if (window.settings.snackAbilitato) noteDestinazioni.push("snack");
			}
			// ---> INSERISCI QUI LA CATTURA TAVOLO <---
			let numeroTavolo = "";
			if (window.settings.richiediTavolo) {
			    const inputTavolo = document.getElementById("numeroTavoloCassa");
			    if (inputTavolo) numeroTavolo = inputTavolo.value.trim();
			}
			const nuovaComanda = {
			    numero: numeroComandaFinale,
			    piatti: piattiValidi || [],
			    statoCucina: cibo.length > 0 ? "da fare" : "completato",
			    statoBere: bere.length > 0 ? "da fare" : "completato",
			    // 🔹 FIX: Dichiariamo SEMPRE gli stati. Se non ci sono piatti (o disattivati), vanno a completato automaticamente.
			    statoSnack: snack.length > 0 ? "da fare" : "completato",
			    statoExtra1: extra1.length > 0 ? "da fare" : "completato",
			    statoExtra2: extra2.length > 0 ? "da fare" : "completato",
			    statoExtra3: extra3.length > 0 ? "da fare" : "completato",
			    timestamp: Date.now(),
			    orario: orario,
			    note: note || "",
			    noteDestinazioni: noteDestinazioni,
			    commento: commentoAsporto || null,
			    metodoPagamento: metodoPagamento,
			    scontoGlobale: window.scontoGlobaleCorrente || null,
				tavolo: numeroTavolo,
			    uidCassiere: uid
			};
			
			// 🔹 FIX: Elimina o commenta i 4 if() successivi che accendevano gli Extra. 
			// La nuovaComanda gestisce già tutto al suo interno in modo infallibile!
			
				
				// Salvataggio nel DB
	        await ref.set(nuovaComanda);
	
	        // 🔹 AVVIO TIMER ANNULLAMENTO (SE ABILITATO)
	        if (window.settings.annullamentoVendita) {
	            avviaTimerAnnullamento(ref.key, nuovaComanda);
	        }
	
	        // --- 7. STAMPA E RESET FRONTEND (MANTENUTO) ---
            const piattiDaStampare = [...comandaCorrente];
            const noteDaStampare = note;
            const numeroComandaDaStampare = numeroComandaFinale;
			const scontoDaStampare = window.scontoGlobaleCorrente ? JSON.parse(JSON.stringify(window.scontoGlobaleCorrente)) : null;
            const asportoCheck = document.getElementById("checkAsporto");
      		const testoAsporto = (asportoCheck && asportoCheck.checked) ? "DA ASPORTO" : "";
            comandaCorrente = [];
			window.rimuoviScontoGlobaleCassa();
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
                   stampaComanda(piattiDaStampare, numeroComandaFinale, noteDaStampare, { 
                        scontoGlobale: scontoDaStampare,
                        commento: testoAsporto,
                        tavolo: numeroTavolo // <--- AGGIUNGI QUESTA RIGA ESATTAMENTE QUI!
                     });
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
            prezzo: p.sconto ? (calcolaPrezzoConSconto(p) / p.quantita) : p.prezzo, // prezzo unitario calcolato
            
            // 🔥 ECCO LA MAGIA: AGGIUNGIAMO I DATI CHE MANCAVANO!
            extraPrezzo: p.extraPrezzo || 0,
            varianti: p.varianti ? JSON.parse(JSON.stringify(Array.isArray(p.varianti) ? p.varianti : Object.values(p.varianti))) : [],
            contorniScelti: p.contorniScelti ? JSON.parse(JSON.stringify(Array.isArray(p.contorniScelti) ? p.contorniScelti : Object.values(p.contorniScelti))) : [],
            sconto: p.sconto || null
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
    if (typeof ultimoDatoLive === 'undefined') window.ultimoDatoLive = ""; // Previene errori se la variabile non è ancora dichiarata
    
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
	const msgLower = msg.toLowerCase();
    if (msgLower.includes("nuovo messaggio") && window.aggiungiNotificaBadge) window.aggiungiNotificaBadge("chat");
    if (msgLower.includes("nuova comanda") && window.aggiungiNotificaBadge) window.aggiungiNotificaBadge("comande");
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
        // 🔹 MODIFICA: Stampa SEMPRE prima la copia cliente completa
        reparti.push({ nome: "COPIA CLIENTE", items: items });

        // Usiamo il nuovo smistatore intelligente
        const separati = separaComanda(items);
        if (separati.cibo.length > 0) reparti.push({ nome: "CUCINA", items: separati.cibo });
        if (separati.bere.length > 0) reparti.push({ nome: "BERE", items: separati.bere });
        if (separati.snack.length > 0) reparti.push({ nome: "SNACK", items: separati.snack });
        
        // Aggiungi i profili extra con il loro nome personalizzato in MAIUSCOLO
        if (separati.extra1.length > 0) reparti.push({ nome: (window.nomiRepartiExtra?.extra1 || "EXTRA 1").toUpperCase(), items: separati.extra1 });
        if (separati.extra2.length > 0) reparti.push({ nome: (window.nomiRepartiExtra?.extra2 || "EXTRA 2").toUpperCase(), items: separati.extra2 });
        if (separati.extra3.length > 0) reparti.push({ nome: (window.nomiRepartiExtra?.extra3 || "EXTRA 3").toUpperCase(), items: separati.extra3 });
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

        // ---> INIZIO STAMPA NUMERO TAVOLO <---
        if (cliente && cliente.tavolo) {
            doc.setFontSize(20); 
            doc.text(`TAVOLO: ${cliente.tavolo}`, pageWidth / 2, y, { align: "center" }); y += 8;
        }
        // ---> FINE STAMPA NUMERO TAVOLO <---
		if (cliente && cliente.commento && cliente.commento.toUpperCase().includes("ASPORTO")) {
            doc.setFontSize(18); 
            doc.text(`*** DA ASPORTO ***`, pageWidth / 2, y, { align: "center" }); y += 8;
        }

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

        // --- INIZIO STAMPA SCONTO GLOBALE ---
        // Controlla se c'è uno sconto in corso (dalla cassa) oppure se è salvato nel cliente (se stiamo ristampando dallo storico)
        const scontoDaApplicare = (cliente && cliente.scontoGlobale) ? cliente.scontoGlobale : window.scontoGlobaleCorrente;

        if (scontoDaApplicare) {
            let testoValoreSconto = "";
            let importoSconto = 0;
            
            if (scontoDaApplicare.tipo === "gratis") {
                testoValoreSconto = "OMAGGIO";
                importoSconto = totaleReparto;
            } else if (scontoDaApplicare.tipo === "percentuale") {
                testoValoreSconto = `- ${scontoDaApplicare.valore}%`;
                importoSconto = totaleReparto * (scontoDaApplicare.valore / 100);
            } else if (scontoDaApplicare.tipo === "fisso") {
                testoValoreSconto = `- €${scontoDaApplicare.valore.toFixed(2)}`;
                importoSconto = scontoDaApplicare.valore;
                // Evitiamo scontrini negativi in caso di scontrini separati
                if (importoSconto > totaleReparto) importoSconto = totaleReparto; 
            }

            totaleReparto -= importoSconto;
            if (totaleReparto < 0) totaleReparto = 0;

            doc.setFontSize(11); doc.setFont("helvetica", "bold");
            const nomeScontoSplit = doc.splitTextToSize(`SCONTO: ${scontoDaApplicare.nome}`, 55);
            doc.text(nomeScontoSplit, margin, y);
            doc.text(testoValoreSconto, rightMargin, y, { align: "right" }); 
            y += (nomeScontoSplit.length * 5) + 2;
        }
        // --- FINE STAMPA SCONTO GLOBALE ---

        doc.setFontSize(18); doc.setFont("helvetica", "bold");
        doc.text("TOTALE", margin, y); doc.text(`€ ${totaleReparto.toFixed(2)}`, rightMargin, y, { align: "right" }); y += 8;

        doc.setFontSize(11); doc.setFont("helvetica", "normal");
        if (cliente && cliente.restoRichiesto && cliente.restoRichiesto > 0) { doc.text(`Da dare resto su: € ${cliente.restoRichiesto}`, margin, y); y += 6; }
        if (note) {
            y += 2;
            doc.setFontSize(10);
            doc.setFont("helvetica", "bold");
            const noteSplit = doc.splitTextToSize(`NOTE: ${note}`, pageWidth - margin*2);
            doc.text(noteSplit, margin, y);
            y += (noteSplit.length * 5);
        }

        // ---> 1. QR CODE STATO ORDINE (Solo copia cliente) <---
        if (window.settings.qrCodeStatoOrdine && (!reparto.nome || reparto.nome === "COPIA CLIENTE")) {
            if (y > 190) { doc.addPage(); y = 10; } 
            
            y += 5;
            doc.setFontSize(12);
            doc.setFont("helvetica", "bold");
            doc.text("SEGUI IL TUO ORDINE LIVE!", pageWidth / 2, y, { align: "center" });
            y += 5;
            
            doc.setFontSize(9);
            doc.setFont("helvetica", "normal");
            doc.text("Inquadra il QR con la fotocamera:", pageWidth / 2, y, { align: "center" });
            y += 2;
            
            // INSERISCI QUI IL NOME DEL FILE CHE VUOI CREARE (es. live.html)
            const baseUrl = "https://bolgino.github.io/BistroBo-App/stato-ordine.html";
            const trackingLink = `${baseUrl}?n=${numeroComanda}`;
            
            try {
                const qr = new QRious({
                    value: trackingLink,
                    size: 200,
                    level: 'H'
                });
                const qrBase64 = qr.toDataURL();
                
                const qrSizeMM = 35; 
                const qrX = (pageWidth - qrSizeMM) / 2; 
                doc.addImage(qrBase64, 'PNG', qrX, y, qrSizeMM, qrSizeMM);
                y += qrSizeMM + 5;
            } catch(e) {
                console.error("Errore generazione QR Code:", e);
            }
            doc.text("-".repeat(45), pageWidth / 2, y, { align: "center" }); 
            y += 6;
        }

        // --- GIOCHI RANDOM SULLO SCONTRINO ---
        if (window.settings.giocoScontrino && (!reparto.nome || reparto.nome === "COPIA CLIENTE")) {
            // Controlla se c'è spazio sufficiente sulla pagina, altrimenti ne aggiunge una
            if (y > 210) { doc.addPage(); y = 10; }
            
            y += 10;
            doc.setFontSize(12);
            doc.setFont("helvetica", "bold");
            doc.text("--- GIOCO DEL GIORNO ---", pageWidth / 2, y, { align: "center" });
            y += 6;
            
            doc.setFontSize(10);
            doc.setFont("helvetica", "normal");

            const tipiGiochi = [
                "tris", "sudoku", "puntini", "labirinto", 
                "forza4", "parole_intrecciate", "scatole", "cruciverba"
            ];
            
            const giocoScelto = tipiGiochi[Math.floor(Math.random() * tipiGiochi.length)];
            let startX;

            switch(giocoScelto) {
                case "tris":
                    // 🎮 1. TRIS
                    doc.text("Sfida i tuoi amici a TRIS nell'attesa!", pageWidth / 2, y, { align: "center" });
                    y += 6;
                    startX = (pageWidth / 2) - 15;
                    doc.setLineWidth(0.5);
                    doc.line(startX + 10, y, startX + 10, y + 30);
                    doc.line(startX + 20, y, startX + 20, y + 30);
                    doc.line(startX, y + 10, startX + 30, y + 10);
                    doc.line(startX, y + 20, startX + 30, y + 20);
                    y += 35;
                    break;

                case "sudoku":
                    // 🧩 2. SUDOKU
                    doc.text("Risolvi questo SUDOKU per veri chef!", pageWidth / 2, y, { align: "center" });
                    y += 6;
                    startX = (pageWidth / 2) - 22.5;
                    for(let i=0; i<=9; i++) {
                        doc.setLineWidth(i % 3 === 0 ? 0.6 : 0.2);
                        doc.line(startX, y + (i*5), startX + 45, y + (i*5));
                        doc.line(startX + (i*5), y, startX + (i*5), y + 45); 
                    }
                    doc.setFontSize(8);
                    const numSudoku = [
                        {r:0,c:0,n:"5"}, {r:0,c:1,n:"3"}, {r:0,c:4,n:"7"},
                        {r:1,c:0,n:"6"}, {r:1,c:3,n:"1"}, {r:1,c:4,n:"9"}, {r:1,c:5,n:"5"},
                        {r:2,c:1,n:"9"}, {r:2,c:2,n:"8"}, {r:2,c:7,n:"6"},
                        {r:3,c:0,n:"8"}, {r:3,c:4,n:"6"}, {r:3,c:8,n:"3"},
                        {r:4,c:0,n:"4"}, {r:4,c:3,n:"8"}, {r:4,c:5,n:"3"}, {r:4,c:8,n:"1"},
                        {r:5,c:0,n:"7"}, {r:5,c:4,n:"2"}, {r:5,c:8,n:"6"},
                        {r:6,c:1,n:"6"}, {r:6,c:6,n:"2"}, {r:6,c:7,n:"8"},
                        {r:7,c:3,n:"4"}, {r:7,c:4,n:"1"}, {r:7,c:5,n:"9"}, {r:7,c:8,n:"5"},
                        {r:8,c:4,n:"8"}, {r:8,c:7,n:"7"}, {r:8,c:8,n:"9"}
                    ];
                    numSudoku.forEach(num => {
                        doc.text(num.n, startX + (num.c * 5) + 2.5, y + (num.r * 5) + 3.5, {align: "center"});
                    });
                    y += 50;
                    break;

                case "puntini":
                    // 🏠 3. UNISCI I PUNTINI (Tazzina di caffè perfetta - 17 punti)
                    doc.text("Cosa appare? Unisci da 1 a 17!", pageWidth / 2, y, { align: "center" });
                    y += 6;
                    let cx = (pageWidth / 2);
                    
                    // Coordinate geometricamente bilanciate (nessun punto sovrapposto)
                    const punti = [
                        {x: -4, y: 2, n: "1"},   // Inizio fumo
                        {x: -1, y: 6, n: "2"},   // Curva fumo
                        {x: -6, y: 10, n: "3"},  // Base fumo
                        {x: -11, y: 13, n: "4"}, // Bordo alto sinistro tazza
                        {x: 11, y: 13, n: "5"},  // Bordo alto destro tazza
                        {x: 16, y: 13, n: "6"},  // Manico alto
                        {x: 19, y: 16, n: "7"},  // Manico esterno
                        {x: 15, y: 19, n: "8"},  // Manico basso
                        {x: 8, y: 19, n: "9"},   // Lato destro tazza
                        {x: 6, y: 24, n: "10"},  // Fondo destro tazza
                        {x: 16, y: 25, n: "11"}, // Punta destra piattino
                        {x: 12, y: 28, n: "12"}, // Base destra piattino
                        {x: -12, y: 28, n: "13"},// Base sinistra piattino
                        {x: -16, y: 25, n: "14"},// Punta sinistra piattino
                        {x: -6, y: 24, n: "15"}, // Fondo sinistro tazza
                        {x: -8, y: 19, n: "16"}, // Lato sinistro tazza
                        {x: -10, y: 15, n: "17"} // Chiusura lato sinistro (separato dal 4)
                    ];
                    
                    doc.setFontSize(6);
                    punti.forEach(p => {
                        doc.circle(cx + p.x, y + p.y, 0.5, "F");
                        // Posiziona il numerino distanziato per una lettura chiara
                        doc.text(p.n, cx + p.x + 1.2, y + p.y + 1.2);
                    });
                    
                    y += 40;
                    break;

                case "labirinto":
                    // 🗺️ 4. LABIRINTO (Griglia 6x6 ad alta densità con vicoli ciechi)
                    doc.text("Trova l'uscita del LABIRINTO!", pageWidth / 2, y, { align: "center" });
                    y += 6;
                    startX = (pageWidth / 2) - 15;
                    let cs = 5; // Dimensione cella (5mm x 6 celle = 30mm totali)
                    
                    doc.setLineWidth(0.4);
                    
                    // 1 = Muro, 0 = Passaggio
                    // Array dei muri orizzontali interni (5 righe divisorie)
                    const hWalls = [
                        [0, 1, 0, 1, 0, 0], // Tra riga 1 e 2
                        [0, 1, 1, 1, 0, 0], // Tra riga 2 e 3
                        [0, 0, 0, 0, 1, 1], // Tra riga 3 e 4
                        [0, 0, 0, 1, 1, 0], // Tra riga 4 e 5
                        [0, 1, 0, 0, 0, 1]  // Tra riga 5 e 6
                    ];
                    
                    // Array dei muri verticali interni (5 colonne divisorie)
                    const vWalls = [
                        [0, 0, 1, 0, 1, 0], // Tra colonna 1 e 2
                        [1, 0, 0, 1, 1, 0], // Tra colonna 2 e 3
                        [0, 1, 1, 1, 0, 0], // Tra colonna 3 e 4
                        [0, 1, 0, 0, 1, 1], // Tra colonna 4 e 5
                        [0, 0, 1, 0, 0, 0]  // Tra colonna 5 e 6
                    ];

                    // Disegna i muri perimetrali con le aperture IN e OUT
                    doc.line(startX, y + cs, startX, y + 30); // Sinistra (aperto in alto per IN)
                    doc.line(startX + 30, y, startX + 30, y + 25); // Destra (aperto in basso per OUT)
                    doc.line(startX, y, startX + 30, y); // Alto
                    doc.line(startX, y + 30, startX + 30, y + 30); // Basso
                    
                    // Ciclo per disegnare i muri orizzontali interni
                    for(let r = 0; r < 5; r++) {
                        for(let c = 0; c < 6; c++) {
                            if(hWalls[r][c]) {
                                doc.line(startX + c*cs, y + (r+1)*cs, startX + (c+1)*cs, y + (r+1)*cs);
                            }
                        }
                    }
                    
                    // Ciclo per disegnare i muri verticali interni
                    for(let c = 0; c < 5; c++) {
                        for(let r = 0; r < 6; r++) {
                            if(vWalls[c][r]) {
                                doc.line(startX + (c+1)*cs, y + r*cs, startX + (c+1)*cs, y + (r+1)*cs);
                            }
                        }
                    }

                    // Etichette IN e OUT
                    doc.setFontSize(6);
                    doc.text("IN", startX - 6, y + 3.5);
                    doc.text("OUT", startX + 31, y + 28.5);
                    
                    y += 40;
                    break;

                case "forza4":
                    // 🔴 5. FORZA 4
                    doc.text("FORZA 4: Sfida chi hai di fronte!", pageWidth / 2, y, { align: "center" });
                    y += 6;
                    startX = (pageWidth / 2) - 17.5;
                    doc.setLineWidth(0.3);
                    doc.rect(startX, y, 35, 30);
                    for(let row=0; row<6; row++) {
                        for(let col=0; col<7; col++) {
                            doc.circle(startX + 2.5 + (col*5), y + 2.5 + (row*5), 1.5);
                        }
                    }
                    y += 35;
                    break;

                case "parole_intrecciate":
                    // 🔠 6. PAROLE INTRECCIATE 
                    doc.text("TROVA LE PAROLE NASCOSTE", pageWidth / 2, y, { align: "center" });
                    y += 6;
                    startX = (pageWidth / 2) - 14;
                    doc.setFontSize(10);
                    doc.setFont("courier", "bold");
                    
                    let grid = [
                        "T O N R O F C",
                        "M A X Y Z W U",
                        "E A V K J H C",
                        "N Z L O X Y I",
                        "U Z D F L G N",
                        "B I R R A O A",
                        "F P Y K T K B"
                    ];
                    
                    grid.forEach((row, i) => {
                        doc.text(row, startX, y + (i*5));
                    });
                    
                    doc.setFont("helvetica", "normal");
                    doc.setFontSize(7);
                    doc.text("Attento! Si leggono in ogni direzione:", pageWidth / 2, y + 36, { align: "center" });
                    doc.text("BIRRA, CUCINA, FORNO, MENU, PIZZA, TAVOLO", pageWidth / 2, y + 40, { align: "center" });
                    y += 45;
                    break;
					
                case "scatole":
                    // ⬛ 7. IL GIOCO DEI PUNTINI E SCATOLE
                    doc.text("PUNTINI: Chiudi più quadrati di tutti!", pageWidth / 2, y, { align: "center" });
                    y += 6;
                    startX = (pageWidth / 2) - 11.25;
                    for(let row=0; row<4; row++) {
                        for(let col=0; col<4; col++) {
                            doc.circle(startX + (col*7.5), y + (row*7.5), 0.5, "F");
                        }
                    }
                    y += 30;
                    break;

               case "cruciverba":
                    // 📝 8. VERO CRUCIVERBA (5x5 con caselle nere, stile classico)
                    doc.text("IL MINI CRUCIVERBA", pageWidth / 2, y, { align: "center" });
                    y += 6;
                    
                    // Griglia 5x5 da 6mm a cella (totale 30mm, centrata)
                    let cellSize = 6;
                    startX = (pageWidth / 2) - 15; 
                    
                    // Coordinate delle caselle nere "riga,colonna"
                    let blackCells = ["0,0", "0,4", "2,2", "4,0", "4,4"];
                    
                    // Disegna Griglia 5x5
                    for (let r = 0; r < 5; r++) {
                        for (let c = 0; c < 5; c++) {
                            let cellId = r + "," + c;
                            doc.setLineWidth(0.3);
                            
                            if (blackCells.includes(cellId)) {
                                doc.setFillColor(0, 0, 0); // Nero
                                doc.rect(startX + c * cellSize, y + r * cellSize, cellSize, cellSize, "FD");
                            } else {
                                doc.setFillColor(255, 255, 255); // Bianco
                                doc.rect(startX + c * cellSize, y + r * cellSize, cellSize, cellSize, "FD");
                            }
                        }
                    }
                    
                    // Numerini delle definizioni
                    doc.setFontSize(4.5);
                    // Riga 0
                    doc.text("1", startX + cellSize + 0.8, y + 1.8);
                    doc.text("2", startX + 2*cellSize + 0.8, y + 1.8);
                    doc.text("3", startX + 3*cellSize + 0.8, y + 1.8);
                    // Riga 1
                    doc.text("4", startX + 0.8, y + cellSize + 1.8);
                    doc.text("5", startX + 4*cellSize + 0.8, y + cellSize + 1.8);
                    // Riga 2
                    doc.text("6", startX + 0.8, y + 2*cellSize + 1.8);
                    doc.text("7", startX + 3*cellSize + 0.8, y + 2*cellSize + 1.8);
                    // Riga 3
                    doc.text("8", startX + 0.8, y + 3*cellSize + 1.8);
                    doc.text("9", startX + 2*cellSize + 0.8, y + 3*cellSize + 1.8);
                    // Riga 4
                    doc.text("10", startX + cellSize + 0.8, y + 4*cellSize + 1.8);


                    // Definizioni
                    doc.setFontSize(6);
                    let textX = startX - 2; // Allineamento ottimizzato per lo scontrino

                    doc.text("ORIZZONTALI:", textX, y + 35);
                    doc.text("1. Segno d'aiuto       4. Seguito del re", textX, y + 38);
                    doc.text("6. La e eufonica       7. Adesso in versi", textX, y + 41);
                    doc.text("8. Ha molti tasti      10. Sento, intendo", textX, y + 44);
                    
                    doc.text("VERTICALI:", textX, y + 49);
                    doc.text("1. Nel sale da cucina  2. Porta logica", textX, y + 52);
                    doc.text("3. Canto male       4. Codice postale", textX, y + 55);
                    doc.text("5. Lo fui in passato   9. Preposizione", textX, y + 58);
                    
                    y += 65;
                    break;
            }
        }
		// ---> 3. IL SALUTO FINALE (Sempre in fondo a tutto) <---
        // Controllo di sicurezza: se il gioco ha riempito la pagina, andiamo su quella nuova
        if (y > 240) { doc.addPage(); y = 10; }
        
        y += 8;
        doc.setFontSize(10);
        doc.setFont("helvetica", "italic");
        doc.text("Grazie e Buon Appetito!", pageWidth / 2, y, { align: "center" });
        y += 5; // Margine finale prima del taglio
    });

    // --- 3. CREAZIONE FINESTRA SINGOLA E STAMPA ---
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
const temiDisponibili = ["default", "scout", "autunno", "inverno", "primavera", "estate","chiaro","notte","astronave"];
function aggiornaTema(tema, salvaSuFirebase = false) {
  // 🔹 Rimuove tutte le classi dei temi
  document.body.classList.remove(
    "tema-default", "tema-scout", "tema-autunno",
    "tema-inverno", "tema-primavera", "tema-estate",  
	  "tema-chiaro","tema-notte","tema-astronave"
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
// ================= CALCOLO TEMPO MEDIO CASSA =================
async function aggiornaTempoMedioCassa(comandeData) {
    const spanCassa = document.getElementById("valoreTempoMedioCassa");
    const boxCassa = document.getElementById("boxTempoMedioCassa");
    if (!spanCassa) return;

    // 1. Recupera le impostazioni dei filtri da Firebase
    let esclusioni = { bere: false, snack: false, extra1: false, extra2: false, extra3: false };
    try {
        const snap = await db.ref("impostazioni/esclusioniTempoCassa").once("value");
        if (snap.exists()) {
            esclusioni = snap.val();
        }
    } catch(e) { console.error("Errore lettura esclusioni:", e); }

    const reparti = ["cucina", "bere", "snack", "extra1", "extra2", "extra3"];
    let tempiValidi = [];

    // 2. Calcola i tempi solo per i reparti NON esclusi
    Object.values(comandeData).forEach(c => {
        const { cibo, bere, snack, extra1, extra2, extra3 } = separaComanda(c.piatti || []);
        
        reparti.forEach(rep => {
            // Se il reparto è escluso dalle impostazioni, lo saltiamo
            if (esclusioni[rep]) return;

            // Verifichiamo se ci sono piatti in questo reparto per questa comanda
            let hasItems = false;
            if (rep === "cucina" && cibo.length > 0) hasItems = true;
            if (rep === "bere" && bere.length > 0) hasItems = true;
            if (rep === "snack" && snack.length > 0) hasItems = true;
            if (rep === "extra1" && extra1.length > 0) hasItems = true;
            if (rep === "extra2" && extra2.length > 0) hasItems = true;
            if (rep === "extra3" && extra3.length > 0) hasItems = true;

            // Se il reparto aveva piatti ed è "completato", prendiamo il suo tempo specifico
            if (hasItems) {
                const statoKey = "stato" + rep.charAt(0).toUpperCase() + rep.slice(1);
                const stato = c[statoKey];
                
                if (stato === "completato" && c.timestamp && c["timestampFine_" + rep]) {
                    let durata = c["timestampFine_" + rep] - c.timestamp;
                    // Scartiamo anomalie (es. negative o più vecchie di 24 ore)
                    if (durata > 0 && durata < 86400000) { 
                        tempiValidi.push(durata);
                    }
                }
            }
        });
    });

    // 3. Mostra la media in Cassa
    if (tempiValidi.length > 0) {
        let sum = tempiValidi.reduce((a, b) => a + b, 0);
        let mediaMin = (sum / tempiValidi.length / 60000).toFixed(1);
        spanCassa.innerText = mediaMin;
        
        if(boxCassa) boxCassa.style.display = "block"; // <-- AGGIUNGI QUESTO
    } else {
        spanCassa.innerText = "--";
        
        if(boxCassa) boxCassa.style.display = "none"; // <-- AGGIUNGI QUESTO
    }
}
// Funzione intelligente per aggiornare lo stato e salvare il timestamp di fine preparazione cibo
// --- FUNZIONE DI AGGIORNAMENTO STATO E CONTROLLO TERMINE GLOBALE ---
async function aggiornaStatoConTermine(comandaId, chiaveStato, nuovoStato) {
    const comandaRef = db.ref("comande/" + comandaId);
    await comandaRef.update({ [chiaveStato]: nuovoStato });
    
    // Controlla se la comanda è terminata in tutti i reparti ATTIVI E CHE HANNO PIATTI
    const snapshot = await comandaRef.once("value");
    const c = snapshot.val();
    if (!c) return;

    const { cibo, bere, snack, extra1, extra2, extra3 } = separaComanda(c.piatti || []);
    const s = window.settings || {};
    
    let completata = true;
    if (cibo.length > 0 && c.statoCucina !== "completato") completata = false;
    if (bere.length > 0 && c.statoBere !== "completato") completata = false;
    
    // 🔹 FIX: Ora la chiusura ordine controlla finalmente anche lo stato degli Extra
    if ((s.snackAbilitato === true || s.snackAbilitato === "true") && snack.length > 0 && c.statoSnack !== "completato") completata = false;
    if ((s.extra1Abilitato === true || s.extra1Abilitato === "true") && extra1.length > 0 && c.statoExtra1 !== "completato") completata = false;
    if ((s.extra2Abilitato === true || s.extra2Abilitato === "true") && extra2.length > 0 && c.statoExtra2 !== "completato") completata = false;
    if ((s.extra3Abilitato === true || s.extra3Abilitato === "true") && extra3.length > 0 && c.statoExtra3 !== "completato") completata = false;

    if (completata) {
        await comandaRef.update({ completataGlobale: true, terminataIl: Date.now() });
    } else {
        await comandaRef.update({ completataGlobale: null, terminataIl: null });
    }
}
// ================= GESTIONE BADGE NOTIFICHE TAB (WHATSAPP STYLE) =================
window.badgeCounts = window.badgeCounts || {};

window.aggiungiNotificaBadge = function(tipo) {
    // Scopre quali tab cercare in base al tipo di notifica
    let tabSelector = "";
    if (tipo === "chat") tabSelector = "[data-tab*='chat' i]";
    if (tipo === "preordini") tabSelector = "[data-tab*='preordin' i]";
    if (tipo === "comande") tabSelector = "[data-tab*='daFare' i], [data-tab*='daBere' i], [data-tab*='daSnack' i], [data-tab*='comande' i]";

    const bottoni = Array.from(document.querySelectorAll(`.tabBtn${tabSelector}`));
    
    bottoni.forEach(btn => {
        // Ignora i bottoni dei profili che in questo momento sono nascosti (es. sei Admin e ignora i bottoni Cucina)
        if (btn.closest(".hidden") || btn.style.display === "none") return;
        
        const tabId = btn.dataset.tab;
        const tabElement = document.getElementById(tabId);
        
        // Se la tab è già attiva (l'utente la sta guardando), non mettiamo la notifica
        if (tabElement && tabElement.classList.contains("active")) return;

        window.badgeCounts[tabId] = (window.badgeCounts[tabId] || 0) + 1;
        
        let badge = btn.querySelector(".badge-notifica");
        if (!badge) {
            badge = document.createElement("span");
            badge.className = "badge-notifica";
            // Stile inline pallino rosso tipo WhatsApp
            badge.style.cssText = "background-color: #ff3b30; color: white; border-radius: 50%; padding: 2px 6px; font-size: 0.85em; font-weight: bold; margin-left: 6px; vertical-align: super; position: relative; z-index: 10; box-shadow: 0 2px 4px rgba(0,0,0,0.2);";
            btn.appendChild(badge);
        }
        badge.innerText = window.badgeCounts[tabId];
    });
};

// Azzera il numerino rosso appena l'utente clicca sulla tab
document.addEventListener("click", e => {
    const btn = e.target.closest(".tabBtn");
    if (btn) {
        const tabId = btn.dataset.tab;
        window.badgeCounts[tabId] = 0;
        const badge = btn.querySelector(".badge-notifica");
        if (badge) badge.remove();
    }
});
// ================= VISTA SOMMARIO GLOBALE =================
let ruoloSommarioAperto = null;

window.apriVistaSommario = function(reparto) {
    ruoloSommarioAperto = reparto;
    document.getElementById('modal-sommario').style.display = 'flex';
    aggiornaVistaSommario(reparto);
};

window.chiudiVistaSommario = function() {
    ruoloSommarioAperto = null;
    document.getElementById('modal-sommario').style.display = 'none';
};

function aggiornaVistaSommario(reparto) {
    if (!reparto || !checkOnline(true)) return;
    
    // Leggiamo tutte le comande direttamente dal DB
    db.ref("comande").once("value", snap => {
        const comande = snap.val() || {};
        const totali = {};

        // 1. Mappatura stato dinamica (es: statoCucina, statoBere)
        const statoKey = reparto.startsWith("extra") 
            ? "stato" + reparto.charAt(0).toUpperCase() + reparto.slice(1) 
            : (reparto === "cucina" ? "statoCucina" : (reparto === "bere" ? "statoBere" : "statoSnack"));

        // 2. ⚠️ FIX CRUCIALE: Il tuo separaComanda restituisce 'cibo', non 'cucina'!
        const arrayKey = reparto === "cucina" ? "cibo" : reparto;

        Object.values(comande).forEach(ordine => {
            // Conta solo ciò che è "da fare" o "in elaborazione"
            if (ordine[statoKey] === 'da fare' || ordine[statoKey] === 'in elaborazione') {
                
                const piattiSeparati = separaComanda(ordine.piatti || []);
                
                // Usiamo l'arrayKey corretta ('cibo' invece di 'cucina')
                const piattiReparto = piattiSeparati[arrayKey] || [];
                
                piattiReparto.forEach(articolo => {
                    // Contiamo i piatti principali
                    if (articolo.isMainHere !== false) {
                        let nomePiatto = articolo.nome.replace(/\s*\([\+\-].*?\)/g, "").trim(); 
                        totali[nomePiatto] = (totali[nomePiatto] || 0) + parseInt(articolo.quantita || 1);
                    }

                    // Se ci sono contorni gestiti dallo stesso reparto, sommiamo anche loro
                    if (articolo.contorniScelti && articolo.contorniScelti.length > 0) {
                        articolo.contorniScelti.forEach(c => {
                            let nomeContorno = c.nome.replace(/\s*\([\+\-].*?\)/g, "").trim();
                            totali[nomeContorno] = (totali[nomeContorno] || 0) + parseInt(articolo.quantita || 1);
                        });
                    }
                });
            }
        });

        // Disegna l'interfaccia
        const listaHtml = document.getElementById('lista-totali-sommario');
        if (!listaHtml) return;
        listaHtml.innerHTML = ''; 

        // Ordiniamo dalla quantità più alta alla più bassa
        const voci = Object.entries(totali).sort((a, b) => b[1] - a[1]); 

        if (voci.length === 0) {
            listaHtml.innerHTML = `<li style="justify-content:center; color:#777; font-size:1.2rem; border:none; padding:40px;">Nessun piatto in coda! 🎉 Dai una pulita alla griglia!</li>`;
        } else {
            for (const [nome, qta] of voci) {
                listaHtml.innerHTML += `
                    <li>
                        <span class="qta-evidenza">${qta}</span> ${nome}
                    </li>
                `;
            }
        }

        // Aggiorna il titolo
        let nomeReparto = reparto;
        if (reparto.startsWith("extra") && window.nomiRepartiExtra && window.nomiRepartiExtra[reparto]) {
            nomeReparto = window.nomiRepartiExtra[reparto];
        }
        
        const repTitolo = document.getElementById('reparto-titolo');
        if (repTitolo) repTitolo.innerText = `(${nomeReparto.toUpperCase()})`;
    });
}

// AGGIORNAMENTO IN TEMPO REALE!
// Quando qualsiasi comanda cambia sul database, aggiorniamo il modale se è aperto
db.ref("comande").on("value", snap => {
    if (ruoloSommarioAperto) {
        aggiornaVistaSommario(ruoloSommarioAperto);
    }
});
// ================= GESTIONE TASTIERA (ESC / ENTER) =================
document.addEventListener("keydown", function(e) {
    // Escludiamo il caso in cui l'utente sta scrivendo in una textarea (es. le note comanda o la chat).
    // Vogliamo che l'INVIO mandi a capo il testo, non che confermi/invii cose per sbaglio.
    if (e.target.tagName === "TEXTAREA" && e.key === "Enter") {
        return; 
    }

    // 1. GESTIONE POPUP COMBO (Piatti con contorni)
    const popupCombo = document.getElementById("popupCombo");
    if (popupCombo && popupCombo.style.display === "flex") {
        if (e.key === "Escape") {
            e.preventDefault();
            if (typeof chiudiPopupCombo === "function") chiudiPopupCombo();
        } else if (e.key === "Enter") {
            e.preventDefault();
            const btn = document.getElementById("btnConfermaCombo");
            if (btn) btn.click();
        }
        return; // Ferma l'esecuzione qui se il popup combo era aperto
    }

    // 2. GESTIONE ALTRI MODALI (Filtri, Archiviazione, Disonotify, Sconti, Varianti ecc.)
    // Cerchiamo tutti i modali visibili in primo piano
    const modaliAperti = document.querySelectorAll(".modal-overlay, #popupVisibilitaPreordini, #modal-sommario");
    const modaliVisibili = Array.from(modaliAperti).filter(m => m.style.display !== "none" && !m.classList.contains("hidden"));

    if (modaliVisibili.length > 0) {
        // Prendiamo l'ultimo modale aperto (quello in primissimo piano)
        const modaleAttivo = modaliVisibili[modaliVisibili.length - 1];

        if (e.key === "Escape") {
            e.preventDefault();
            // Cerca il bottone annulla/chiudi usando le classi o il testo
            const btnAnnulla = modaleAttivo.querySelector(".btn-chiudi, #annullaArchiviaBtn, #btnChiudiVisibilitaPreordini") 
                || Array.from(modaleAttivo.querySelectorAll("button")).find(b => b.innerText.toLowerCase().includes("annull") || b.innerText.toLowerCase().includes("chiud"));
            
            if (btnAnnulla) btnAnnulla.click();
            else if (modaleAttivo.id !== "loader" && modaleAttivo.id !== "offlineLoader") modaleAttivo.remove(); 
        } 
        else if (e.key === "Enter") {
            e.preventDefault();
            // Cerca il bottone di conferma/salvataggio 
            const btnConferma = modaleAttivo.querySelector(".btn-salva, #confermaArchiviaBtn, #btnSalvaFondo, #btnSalvaSconto") 
                || Array.from(modaleAttivo.querySelectorAll("button")).find(b => {
                    const txt = b.innerText.toLowerCase();
                    return txt.includes("conferm") || txt.includes("salva") || txt.includes("archivia");
                });
            
            if (btnConferma && !btnConferma.disabled) btnConferma.click();
        }
        return; // Ferma qui se c'era un modale aperto
    }

    // 3. GESTIONE CASSA PRINCIPALE (Se nessun modale è aperto)
    // Permette di usare "INVIO" per spedire la comanda se sei nella schermata Aggiungi Comanda
    if (e.key === "Enter" && window.isLoggedInCassa) {
        const tabAggiungi = document.getElementById("aggiungiComandaTab");
        if (tabAggiungi && tabAggiungi.classList.contains("active")) {
            // Impedisce di inviare la comanda se stiamo cercando qualcosa nella barra di ricerca
            if (e.target.id !== "cercaComandaCassa") {
                const btnInvia = document.getElementById("inviaComandaBtn");
                if (btnInvia && !btnInvia.disabled) {
                    e.preventDefault();
                    btnInvia.click();
                }
            }
        }
    }
});
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
		if(b.dataset.tab === "gamificationTab") caricaGamification();
		
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
// ================= FUNZIONE POPUP CUSTOM (Sostituisce i prompt) =================
function chiediValoreConPopup(titolo, messaggio, valoreDefault, callback) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "10005";
    
    const modal = document.createElement("div");
    modal.className = "modal-varianti";
    modal.style.padding = "25px";
    modal.style.textAlign = "center";
    modal.style.maxWidth = "350px";
    
    modal.innerHTML = `
        <h3 style="margin-top: 0; margin-bottom: 10px; color: #333;">${titolo}</h3>
        <p style="font-size: 0.95em; color: #555; margin-bottom: 15px;">${messaggio}</p>
        <input type="number" id="inputPopupGenerico" value="${valoreDefault}" step="0.01" style="width: 100%; padding: 12px; margin-bottom: 20px; border-radius: 8px; border: 1px solid #ccc; font-size: 1.2em; font-weight: bold; outline: none; text-align: center; box-sizing: border-box;">
        <div class="modal-actions" style="display: flex; gap: 10px;">
            <button class="btn-chiudi" id="btnAnnullaPopup" style="flex: 1; margin:0;">Annulla</button>
            <button class="btn-salva" id="btnConfermaPopup" style="flex: 1; margin:0; background-color: #4CAF50; color: white;">Conferma</button>
        </div>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    // Focussa l'input e seleziona il testo automaticamente per facilitare la digitazione
    const input = document.getElementById("inputPopupGenerico");
    input.focus();
    input.select();
    
    document.getElementById("btnAnnullaPopup").onclick = () => {
        overlay.remove();
        callback(null); // Utente ha annullato
    };
    
    document.getElementById("btnConfermaPopup").onclick = () => {
        const val = input.value;
        overlay.remove();
        callback(val); // Ritorna il valore inserito
    };
}

// ================= MODALITA' NOTTE AUTOMATICA (GLOBALE) =================
window.settings = window.settings || {};

function controllaModalitaNotte() {
    // Recuperiamo il tema originale scelto (se non c'è, usiamo "default")
    const temaOriginale = window.settings.temaSalvato || "default";

    // Se la modalità notte automatica è abilitata
    if (window.settings.modalitaNotte) {
        const oraAttuale = new Date().getHours();
        
        // Attivo dalle 21:00 (incluse) fino alle 04:59 (5 escluso)
        if (oraAttuale >= 21 || oraAttuale < 5) {
            // Applica il tema notte ignorando quello originale. 
            // "false" assicura che NON venga salvato nel Database globale!
            aggiornaTema("notte", false);
        } else {
            // È giorno: ripristiniamo il tema originale scelto
            aggiornaTema(temaOriginale, false);
        }
    } else {
        // Se la modalità automatica è spenta, ci assicuriamo che torni il tema originale
        aggiornaTema(temaOriginale, false);
    }
}

// 1. Ascolta i cambiamenti della modalità notte in tempo reale
db.ref("impostazioni/modalitaNotte").on("value", snap => {
    window.settings.modalitaNotte = snap.val() || false;
    controllaModalitaNotte(); // Aggiorna subito l'interfaccia
});

// 2. Registriamo anche il tema originale scelto.
// Questo ci serve come "memoria" per sapere a quale tema tornare di giorno!
db.ref("impostazioni/tema").on("value", snap => {
    window.settings.temaSalvato = snap.exists() ? snap.val() : "default";
    controllaModalitaNotte(); // Ricalcola subito se serve sovrascrivere con la notte
});

// 3. Controlla l'orologio ogni 60 secondi
// Se scoccano le 21:00 mentre l'app è aperta, il tema passa a "notte" da solo!
setInterval(controllaModalitaNotte, 60000);

// ================= GESTIONE CLICK FUORI DAI MODALI =================
document.addEventListener("mousedown", function(e) {
    // Controlla se l'elemento cliccato è ESATTAMENTE lo sfondo scuro del popup (l'overlay)
    if (e.target.classList.contains("modal-overlay") || 
        e.target.classList.contains("modal") || 
        e.target.classList.contains("modal-cassa-overlay")) {
        
        const modaleAttivo = e.target;
        
        // Evitiamo di chiudere schermate critiche come i caricamenti o l'assenza di rete
        if (modaleAttivo.id === "loader" || modaleAttivo.id === "offlineLoader") return;

        // Cerchiamo il bottone "Annulla", "Chiudi" o le loro varianti all'interno del modale
        const btnAnnulla = modaleAttivo.querySelector(".btn-chiudi, #annullaArchiviaBtn, #btnChiudiVisibilitaPreordini") || 
                           Array.from(modaleAttivo.querySelectorAll("button")).find(b => 
                               b.innerText.toLowerCase().includes("annull") || 
                               b.innerText.toLowerCase().includes("chiud")
                           );
                           
        if (btnAnnulla) {
            // Se esiste un bottone preposto, lo premiamo virtualmente 
            // (così si occupa lui di resettare variabili, fermare timer, ecc.)
            btnAnnulla.click();
        } else {
            // Se non c'è un bottone, forziamo la chiusura in base al tipo di modale
            if (modaleAttivo.id === "popupCombo" && typeof chiudiPopupCombo === "function") {
                chiudiPopupCombo();
            } else if (modaleAttivo.id === "modal-sommario" && typeof chiudiVistaSommario === "function") {
                chiudiVistaSommario();
            } else if (modaleAttivo.id) {
                // È un modale statico scritto dentro index.html (es. il popup combo)
                modaleAttivo.style.display = "none";
            } else {
                // È un modale generato "al volo" dal JavaScript (es. chiediValoreConPopup)
                modaleAttivo.remove();
            }
        }
    }
});
// ================= TUTORIAL SCORCIATOIE =================
function apriTutorialScorciatoie() {
    const vecchiTutorial = document.querySelectorAll(".modal-scorciatoie-overlay");
    vecchiTutorial.forEach(t => t.remove());

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay modal-scorciatoie-overlay";
    overlay.style.position = "fixed";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100vw";
    overlay.style.height = "100vh";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "10005";
    overlay.style.backgroundColor = "rgba(0, 0, 0, 0.6)"; 

    const modal = document.createElement("div");
    modal.className = "modal-varianti"; 
    modal.style.padding = "25px";
    modal.style.textAlign = "center";
    modal.style.maxWidth = "500px";
    modal.style.width = "90%";
    modal.style.maxHeight = "85vh"; 
    modal.style.overflowY = "auto";
    modal.style.borderRadius = "12px";
    modal.style.boxShadow = "0 10px 30px rgba(0,0,0,0.5)";

    modal.innerHTML = `
        <h3 style="margin-top: 0; font-size: 1.4em;">⌨️ Scorciatoie da Tastiera</h3>
        <p style="font-size: 0.95em; margin-bottom: 15px; text-align: left;">
            Mantieni premuto <b>ALT + Tasto</b> per navigare rapidamente:
        </p>
        
        <div style="text-align: left; background: rgba(128,128,128,0.1); padding: 15px; border-radius: 8px; font-size: 0.9em; line-height: 1.8; margin-bottom: 15px;">
            <b style="color: var(--primary-color, #4CAF50);">-- 🌐 GLOBALI & RICERCA --</b><br>
            <b>Alt + S</b> : Seleziona barra di Ricerca<br>
            <b>Alt + P</b> : Pulisci barra di Ricerca<br>
            <b>Alt + L</b> : Logout / Esci<br>
            <b>Alt + H</b> : Mostra questo Aiuto<br>

            <hr style="border: 0; border-top: 1px solid rgba(128,128,128,0.2); margin: 10px 0;">

            <b style="color: var(--primary-color, #4CAF50);">-- 👑 SIMULAZIONE (Solo Admin) --</b><br>
            <b>Alt + 1</b> : Cassa &nbsp;|&nbsp; <b>Alt + 2</b> : Bere<br>
            <b>Alt + 3</b> : Cucina &nbsp;|&nbsp; <b>Alt + 4</b> : Snack<br>
            <b>Alt + 5, 6, 7</b> : Extra 1, 2, 3<br>
            <b>Alt + 0</b> : Torna ad Admin<br>
            
            <hr style="border: 0; border-top: 1px solid rgba(128,128,128,0.2); margin: 10px 0;">
            
            <b style="color: var(--primary-color, #4CAF50);">-- 💶 IN CASSA --</b><br>
            <b>Alt + I</b> : Invia la Comanda (Invio)<br>
            <b>Alt + A</b> : Annulla ultima comanda inviata<br>
            <b>Alt + C</b> : Svuota il carrello<br>
            <b>Alt + R</b> : Azzera il Resto<br>
        </div>
        
        <div class="modal-actions">
            <button class="btn-salva" id="btnHoCapitoScorciatoie" style="width: 100%; cursor: pointer;">Ottimo, ho capito!</button>
        </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const btnChiudi = modal.querySelector("#btnHoCapitoScorciatoie");
    btnChiudi.addEventListener("click", function(e) {
        e.preventDefault();
        e.stopPropagation();
        overlay.remove();
    });
}

// 2. Helper per visibilità elementi HTML (usato solo per azioni contestuali in cassa)
function isVis(elem) {
    return elem && elem.offsetParent !== null;
}

// 3. Verifica se l'utente è Admin analizzando la presenza degli elementi nel DOM (non la visibilità)
function isUtenteAdmin() {
    // Se c'è un bottone con onclick="simulaRuolo" da qualche parte nell'HTML, sei Admin
    if (document.querySelector("[onclick*='simulaRuolo']")) return true;
    // Se c'è il bottone di ritorno (anche se in display:none), sei un Admin in simulazione
    if (document.getElementById("passaACassaBtn")) return true;
    return false;
}

// 4. Motore Logout Esatto
function forzaLogout() {
    const btnOut = document.getElementById("logoutBtn");
    if (btnOut) {
        btnOut.click();
    } else if (typeof logout === "function") {
        logout();
    }
}

// 5. Motore Salto Ruoli (Funziona da QUALSIASI tab per l'Admin)
function saltaA(ruolo) {
    if (!isUtenteAdmin()) return;

    const btnTorna = document.getElementById("passaACassaBtn");
    
    // Se il bottone "Torna ad Admin" è visibile, significa che stiamo GIA' simulando un ruolo.
    // Dobbiamo prima uscire per pulire l'interfaccia.
    if (isVis(btnTorna)) {
        btnTorna.click();
        setTimeout(() => {
            if (typeof simulaRuolo === "function") simulaRuolo(ruolo);
        }, 300);
    } else {
        // Se non stiamo simulando (siamo nella dashboard Admin in qualsiasi tab), lancia diretto
        if (typeof simulaRuolo === "function") simulaRuolo(ruolo);
    }
}

// 6. EVENTO PRINCIPALE TASTIERA
document.addEventListener("keydown", function(e) {
	if (!window.settings.scorciatoieTastiera) return;
    if (e.altKey) {
        const key = e.key.toLowerCase();
        
        // ================= AZIONI UNIVERSALI =================
        switch(key) {
            case 'h': e.preventDefault(); apriTutorialScorciatoie(); return;
            case 'l': e.preventDefault(); forzaLogout(); return;
            case 's': 
                e.preventDefault();
                const allInputsS = Array.from(document.querySelectorAll('input[type="text"], input[type="search"]'));
                const searchInput = allInputsS.find(inp => isVis(inp) && (inp.id.toLowerCase().includes('cerca') || inp.className.toLowerCase().includes('cerca') || inp.placeholder.toLowerCase().includes('cerca')));
                if (searchInput) { searchInput.focus(); searchInput.select(); }
                return;
            case 'p': 
                e.preventDefault();
                const allInputsP = Array.from(document.querySelectorAll('input[type="text"], input[type="search"]'));
                const activeSearch = allInputsP.find(inp => isVis(inp) && (inp.id.toLowerCase().includes('cerca') || inp.className.toLowerCase().includes('cerca') || inp.placeholder.toLowerCase().includes('cerca')));
                if (activeSearch) {
                    activeSearch.value = "";
                    activeSearch.dispatchEvent(new Event('input')); 
                    activeSearch.dispatchEvent(new Event('change'));
                    const btnClear = document.querySelector("[onclick*='pulisci']") || document.getElementById("clearCercaComandaCassa") || document.getElementById("clearRicercaBtn");
                    if (isVis(btnClear)) btnClear.click();
                    activeSearch.focus();
                }
                return;
        }

        // ================= SIMULAZIONE RUOLI (Solo Admin, da qualsiasi tab) =================
        if (isUtenteAdmin()) {
            switch(key) {
                case '1': e.preventDefault(); saltaA('cassa'); return;
                case '2': e.preventDefault(); saltaA('bere'); return;
                case '3': e.preventDefault(); saltaA('cucina'); return;
                case '4': e.preventDefault(); saltaA('snack'); return;
                case '5': e.preventDefault(); saltaA('extra1'); return;
                case '6': e.preventDefault(); saltaA('extra2'); return;
                case '7': e.preventDefault(); saltaA('extra3'); return;
                case '0': 
                    e.preventDefault(); 
                    const btnTorna = document.getElementById("passaACassaBtn");
                    if (btnTorna) btnTorna.click();
                    return;
            }
        }

        // ================= AZIONI IN CASSA =================
        // Queste devono attivarsi SOLO se l'interfaccia della cassa è aperta davanti agli occhi
        const areaCassa = document.getElementById("carrelloContainer") || document.querySelector(".cassa-container");
        
        if (isVis(areaCassa) || isVis(document.getElementById("inviaComandaBtn"))) {
            switch(key) {
                case 'i': 
                    e.preventDefault();
                    const btnInvia = document.getElementById("inviaComandaBtn") || document.querySelector("[onclick*='inviaComanda']");
                    if (isVis(btnInvia) && !btnInvia.disabled) btnInvia.click();
                    return;
                case 'a': 
                    e.preventDefault();
                    const btnAnnulla = document.getElementById("annullaUltimaVenditaBtn") || document.querySelector("[onclick*='annullaUltima']");
                    if (isVis(btnAnnulla)) btnAnnulla.click();
                    return;
                case 'c': 
                    e.preventDefault();
                    if (typeof svuotaCarrello === "function") svuotaCarrello();
                    else {
                        const btnSvuota = document.querySelector("[onclick*='svuotaCarrello']");
                        if (isVis(btnSvuota)) btnSvuota.click();
                    }
                    return;
                case 'r': 
                    e.preventDefault();
                    const btnReset = document.getElementById("resetSoldiBtn") || document.getElementById("btnResetResto") || document.querySelector("[onclick*='resetResto']");
                    if (isVis(btnReset)) btnReset.click();
                    
                    const inputSoldi = document.getElementById("soldiRicevuti") || document.getElementById("inputResto");
                    if (isVis(inputSoldi)) {
                        inputSoldi.value = "";
                        inputSoldi.dispatchEvent(new Event('input'));
                    }
                    return;
            }
        }
    }
});
