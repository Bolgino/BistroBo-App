// ====================== CONFIGURAZIONE FIREBASE ======================
const preordiniRef = db.ref("preordini");
window.isLoggedInCassa = false;
window.isLoggedInAdmin = false;
window.settings = window.settings || {};
window.notificatiCassa = new Set(JSON.parse(localStorage.getItem("notificatiCassa") || "[]"));
window.notificatiAdmin = new Set(JSON.parse(localStorage.getItem("notificatiAdmin") || "[]"));
window.comandeNotificate = new Set(JSON.parse(localStorage.getItem("comandeNotificate") || "[]"));
let carrelloCliente = []; // Qui salveremo i piatti configurati dal cliente
let ingredientiGlobali = {}; // Per avere gli ingredienti sempre a disposizione

// ================================================================
// 🔹 1️⃣ GESTIONE TEMA GLOBALE (uguale al sito principale)
// ================================================================
async function applicaTemaDaDatabase() {
    try {
        const snap = await db.ref("impostazioni/tema").once("value");
        const tema = snap.val() || "default";

        document.body.classList.remove(
            "tema-default","tema-scout","tema-inverno",
            "tema-autunno","tema-primavera","tema-estate"
        );
        document.body.classList.add("tema-" + tema);

        // mostra il body solo dopo aver applicato il tema
        document.body.classList.add("tema-caricato");

        localStorage.setItem("temaSelezionato", tema);
    } catch (err) {
        console.error("Errore nel caricamento del tema:", err);
        document.body.classList.add("tema-caricato"); // fallback
    }
}
function listenTemaRealtime() {
    db.ref("impostazioni/tema").on("value", snap => {
        const tema = snap.val() || "default";

        // Applica tema all’intera pagina
        if (typeof aggiornaTema === "function") {
            aggiornaTema(tema); // se c'è la funzione dell'app interna
        } else {
            document.body.classList.remove(
                "tema-default", "tema-scout", "tema-inverno",
                "tema-autunno", "tema-primavera", "tema-estate"
            );
            document.body.classList.add("tema-" + tema);
        }

        // Aggiorna localStorage
        localStorage.setItem("temaSelezionato", tema);

        // Aggiorna anche titolo dei preordini in base al tema
        aggiornaTitoloPreordini(tema);
    });
}
function aggiornaTitoloPreordini(tema) {
    const titolo = document.querySelector(".preordine-title");
    if (!titolo) return;
}
// ================================================================
// ========== 2️⃣ PARTE INTERNA (CASSA + ADMIN) ====================
// ================================================================

// 🔹 Aggiornamento realtime preordiniAbilitati
db.ref("impostazioni/preordiniAbilitati").on("value", snap => {
    const val = snap.val() ?? false;
    window.settings.preordiniAbilitati = val;

    // 🔹 Clienti
    const inviaBtn = document.getElementById("inviaPreordineBtn");
    const menuDiv = document.getElementById("menuClienti");
    if (menuDiv) menuDiv.style.visibility = "hidden";

    if (inviaBtn) {
        inviaBtn.disabled = !val;
        inviaBtn.innerText = val ? "📩 Invia Preordine" : "⚠ Preordini disabilitati";
    }
    if (menuDiv) {
        // Mostra sempre il div
        menuDiv.style.visibility = "visible";

        if (!val) {
            menuDiv.innerHTML = "<p>I preordini sono disabilitati.</p>";
        } else {
            menuDiv.innerHTML = "";
        }
    }

    // Inizializza sempre la UI
    initPreordiniClienti();


    // 🔹 Cassa
    const tabBtnCassa = document.getElementById("preordiniTabBtn");
    if (tabBtnCassa) tabBtnCassa.style.display = val ? "inline-block" : "none";

    // 🔹 Admin: disabilita/abilita tutti i bottoni Aggiungi già renderizzati
    document.querySelectorAll(".order.admin-preordine .aggiungi").forEach(btn => {
        btn.disabled = !val;
    });
});
/*
document.getElementById("passaACassaBtn")?.addEventListener("click", async () => {
    // Sto simulando la cassa → l’admin NON deve essere considerato admin ora
    isLoggedInCassa = true;
    isLoggedInAdmin = false;
    preordiniRef.off();
    initPreordiniInterni();



    // Prendi i preordini correnti dal DB
    const snap = await preordiniRef.once("value");
    const data = snap.val() || {};

    // Mostra la tab con tutti i preordini
    renderPreordiniCassa(data);
});
document.getElementById("passaAAdminBtn")?.addEventListener("click", async () => {
    // Sto simulando il ritorno a Admin → non sono più in modalità Cassa
    isLoggedInAdmin = true;
    isLoggedInCassa = false;

    try {
        db.ref("ingredienti").off();
        db.ref("comande").off();
        db.ref("menu").off();
        db.ref("utenti").off();
    } catch(e) {}

    // Prima reset
    preordiniRef.off();

    // 🔥 PRIMA ATTACCO LISTENER
    initPreordiniInterni();

    // 🔥 SOLO DOPO prendo lo stato attuale (sincronizzo subito la UI)
    const snap = await preordiniRef.once("value");
    const data = snap.val() || {};
    renderPreordiniAdmin(data);

}); */
function initPreordiniInterni() {
    if (typeof checkOnline === "function" && !checkOnline(true)) return;

    // NON determinare automaticamente isLoggedInCassa qui
    // Lo setti al login e/o clic sul pulsante "Passa a Cassa"

    preordiniRef.on("value", snap => {
        const data = snap.val() || {};

        // 🔥 render sempre aggiornati
        if (isLoggedInAdmin) {
            renderPreordiniAdmin(data);
        }

        if (isLoggedInCassa && !isLoggedInAdmin) {
            renderPreordiniCassa(data);
        }
    });


}
// === Render Preordini Admin ===
async function renderPreordiniAdmin(data) {
    const lista = document.getElementById("listaPreordiniAdmin");
    if (!lista) return;
    // salva sempre lo stato attuale
    ultimiPreordini = data;
    lista.innerHTML = "";

    // Leggi impostazione asporto dal DB
    const snapAsporto = await db.ref("impostazioni/asportoAbilitato").once("value");
    const asportoAbilitato = snapAsporto.exists() && snapAsporto.val() === true;
    
    let ids = Object.keys(data || {});
    if (window.settings.ordinaPreordini) {
        ids.sort((a, b) => data[b].timestamp - data[a].timestamp); // nuovi prima
    } else {
        ids.sort((a, b) => data[a].timestamp - data[b].timestamp); // nuovi ultimi
    }


    if (ids.length === 0) {
        lista.innerHTML = "<p class='nessun-ordine'>Nessun ordine presente.</p>";
        return;
    }

    for (const id of ids) {
        let div = lista.querySelector(`[data-id-preordine="${id}"]`);
        if (!div) {
            div = document.createElement("div");
            div.className = "order admin-preordine";
            div.dataset.idPreordine = id;
            lista.appendChild(div);
        }

        const p = data[id];

        const piattiCibo = p.piatti?.filter(i => i.categoria !== "bevande" && i.categoria !== "snack") || [];
        const piattiBere = p.piatti?.filter(i => i.categoria === "bevande") || [];
        let piattiSnack = p.piatti?.filter(i => i.categoria === "snack") || [];
        if (!window.settings.snackAbilitato && piattiSnack.length > 0) {
            // se snack disabilitato, li mostriamo insieme ai piatti cucina
            piattiCibo.push(...piattiSnack);
            piattiSnack = [];
        }
        let totale = [...piattiCibo, ...piattiBere, ...piattiSnack].reduce((sum, pi) => sum + (Number(pi.prezzo || 0) * (pi.quantita || 0)), 0);
        totale = Number(totale.toFixed(2));
        div.innerHTML = `
        
            <div class="order-header">
                <b>${p.nome}</b>
                ${window.settings.preordiniRichiediInfo && p.telefono ? `
                    <div><b>Telefono:</b> ${p.telefono}</div>
                ` : ""}
                ${window.settings.preordiniRichiediInfo && p.posizione ? `
                    <div><b>Posizione:</b> ${p.posizione}</div>
                ` : ""}
                ${window.settings.preordiniRichiediInfo && p.orarioConsegna ? `
                    <div><b>Orario consegna:</b> ${p.orarioConsegna}</div>
                ` : ""}


            </div>

            <div class="order-body">
                ${piattiCibo.map(pi => `
                    <div>
                        ${pi.quantita}× ${pi.nome} (€${pi.prezzo.toFixed(2)})
                        ${pi.ingredienti && pi.ingredienti.length
                            ? `<div style="font-size:0.75em; color:#555;">
                                Ingredienti: ${pi.ingredienti.map(i => `${i.nome}${i.qtyPerUnit ? ` (${i.qtyPerUnit}${i.unita || ""})` : ""}`).join(", ")}
                            </div>`
                            : ""}
                    </div>
                `).join("")}
                ${piattiBere.map(pi => `
                    <div>
                        ${pi.quantita}× ${pi.nome} (€${pi.prezzo.toFixed(2)})
                        ${pi.ingredienti && pi.ingredienti.length
                            ? `<div style="font-size:0.75em; color:#555;">
                                Ingredienti: ${pi.ingredienti.map(i => `${i.nome}${i.qtyPerUnit ? ` (${i.qtyPerUnit}${i.unita || ""})` : ""}`).join(", ")}
                            </div>`
                            : ""}
                    </div>
                `).join("")}
                ${piattiSnack.map(pi => `
                    <div>
                        ${pi.quantita}× ${pi.nome} (€${pi.prezzo.toFixed(2)})
                        ${pi.ingredienti && pi.ingredienti.length
                            ? `<div style="font-size:0.75em; color:#555;">
                                Ingredienti: ${pi.ingredienti.map(i => `${i.nome}${i.qtyPerUnit ? ` (${i.qtyPerUnit}${i.unita || ""})` : ""}`).join(", ")}
                            </div>`
                            : ""}
                    </div>
                `).join("")}
                ${p.note ? `
                <div><i>Note: ${p.note}</i></div>
                ${window.settings.noteDestinazioniAbilitate ? `
                    <div style="margin-top:4px; font-size:0.85em;">
                        <b>Invia note a:</b>
                        ${["cucina","bere", ...(window.settings.snackAbilitato ? ["snack"] : [])].map(d => `
                            <label style="margin-right:10px;">
                                <input type="checkbox" class="note-destinazione" data-id="${id}" data-destinazione="${d}" ${p.noteDestinazioni?.includes(d) ? "checked" : ""}>
                                ${d.charAt(0).toUpperCase() + d.slice(1)}
                            </label>
                        `).join("")}
                    </div>
                ` : ""}
                ` : ""}

            </div>


            <div class="order-footer">
                <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                    <span>
                        <b>Totale: €${totale.toFixed(2)}</b>
                        ${p.restoRichiesto && p.restoRichiesto > 0 ? `<span style="margin-left:8px;">(Resto: €${p.restoRichiesto})</span>` : ""}
                    </span>

                    <div style="display:flex; align-items:center; gap:10px;">
                        ${asportoAbilitato ? `
                            <label>
                                <input type="checkbox"
                                    onchange="segnaAsporto('${id}', this.checked)"
                                    ${p.asporto ? 'checked' : ''}/> Asporto
                            </label>
                        ` : ""}

                        <label>
                            <select onchange="impostaMetodoPagamento('${id}', this.value)">
                                <option value="contanti" ${p.metodoPagamento === 'contanti' ? 'selected' : ''}>Contanti</option>
                                <option value="pos" ${p.metodoPagamento === 'pos' ? 'selected' : ''}>POS</option>
                            </select>
                        </label>

                        <button class="aggiungi" onclick="aggiungiPreordineAlleComande('${id}')">Aggiungi</button>
                        <button class="elimina" onclick="eliminaPreordine('${id}')">Elimina</button>

                    </div>
                </div>
            </div>
            <div>
                ${p.asporto ? `<div style="font-weight:bold; color:#007b00; margin-top:4px;">📦 Asporto</div>` : ""}

                <div style="font-size:0.8em; color:#777; margin-top:4px;">
                    🕒 Preordine arrivato alle ${p.orario || ''}
                </div>
            </div>
        `;
        const btnAggiungi = div.querySelector(".aggiungi");
        if (btnAggiungi) btnAggiungi.disabled = !window.settings.preordiniAbilitati;
        
    }
    const nuoviAdmin = ids.filter(id => !window.notificatiAdmin.has(id));


    if (isLoggedInAdmin && nuoviAdmin.length > 0) {
        // SOLO notifica, niente suono
        nuoviAdmin.forEach(id => {
            notifypreordini(`📩 Nuovo preordine: ${data[id].nome}`, "info", false);
            window.notificatiAdmin.add(id);

        });
        localStorage.setItem("notificatiAdmin", JSON.stringify([...window.notificatiAdmin]));
    }
}
// === Render Preordini Cassa ===
let ultimiPreordini = {};
function renderPreordiniCassa(data) {
    const lista = document.getElementById("listaPreordiniCassa");
    const tabBtn = document.getElementById("preordiniTabBtn");
    if (!lista || !tabBtn) return;
    lista.innerHTML = "";
    let ids = Object.keys(data || {});

    if (window.settings.ordinaPreordini) {
        ids.sort((a, b) => data[b].timestamp - data[a].timestamp); // nuovi prima
    } else {
        ids.sort((a, b) => data[a].timestamp - data[b].timestamp); // nuovi ultimi
    }

    // 🔹 Nascondi tab se preordini disabilitati
    if (!window.settings.preordiniAbilitati) {
        tabBtn.style.display = "none";
        lista.innerHTML = "<p>Il sistema dei preordini è disabilitato.</p>";
        return;
    }

    const entries = ids
        .map(id => [id, data[id]])
        .filter(([id, o]) => o.stato !== "aggiunto");

        if (entries.length === 0) {
        lista.innerHTML = "<p>Nessun ordine presente.</p>";
        tabBtn.style.display = "none";
        ultimiPreordini = {};
        return;
    }
    // 🔹 Mostra tab sempre se ci sono preordini
    tabBtn.style.display = "inline-block";

    // 🔹 Notifica solo i preordini realmente nuovi
    const nuovi = entries.filter(([id]) => !window.notificatiCassa.has(id));


    if (isLoggedInCassa && !isLoggedInAdmin && nuovi.length > 0) {
        document.getElementById("preordiniTabBtn")?.classList.add("tab-lampeggia");
        if (window.settings?.suonoPreordini && window.settings?.suonoCassa && typeof playSound === "function") {
            playSound("nuovo_preordine");
        }



        // mostra notifiche singole
        nuovi.forEach(([id, p]) => {
            notifypreordini(`📩 Nuovo preordine: ${p.nome}`, "info", false);
            window.notificatiCassa.add(id);
        });

        // aggiorna localStorage
        localStorage.setItem("notificatiCassa", JSON.stringify([...window.notificatiCassa]));
    }
    // Aggiorna stato globale
    ultimiPreordini = Object.fromEntries(entries);

    entries.forEach(([id, p]) => {
        const piattiCibo = p.piatti?.filter(i => i.categoria !== "bevande" && i.categoria !== "snack") || [];
        const piattiBere = p.piatti?.filter(i => i.categoria === "bevande") || [];
        let piattiSnack = p.piatti?.filter(i => i.categoria === "snack") || [];
        if (!window.settings.snackAbilitato && piattiSnack.length > 0) {
            piattiCibo.push(...piattiSnack);
            piattiSnack = [];
        }

        let totale = 0;
        p.piatti?.forEach(pi => totale += (Number(pi.prezzo || 0) * (pi.quantita || 0)));
        totale = Number(totale.toFixed(2));

        const div = document.createElement("div");
        div.className = "order cassa-preordine";

        div.innerHTML = `
            <div class="order-header">
                <b>${p.nome}</b>
                ${window.settings.preordiniRichiediInfo && p.telefono ? `
                    <div><b>Telefono:</b> ${p.telefono}</div>
                ` : ""}
                ${window.settings.preordiniRichiediInfo && p.posizione ? `
                    <div><b>Posizione:</b> ${p.posizione}</div>
                ` : ""}
                ${window.settings.preordiniRichiediInfo && p.orarioConsegna ? `
                    <div><b>Orario consegna:</b> ${p.orarioConsegna}</div>
                ` : ""}


            </div>

            <div class="order-body">
                ${piattiCibo.map(pi => `
                    <div>
                        ${pi.quantita}× ${pi.nome} (€${pi.prezzo.toFixed(2)})
                        ${pi.ingredienti && pi.ingredienti.length
                            ? `<div style="font-size:0.75em; color:#555;">
                                Ingredienti: ${pi.ingredienti.map(i => `${i.nome}${i.qtyPerUnit ? ` (${i.qtyPerUnit}${i.unita || ""})` : ""}`).join(", ")}
                            </div>` : ""}
                    </div>
                `).join("")}
                ${piattiBere.map(pi => `
                    <div>
                        ${pi.quantita}× ${pi.nome} (€${pi.prezzo.toFixed(2)})
                        ${pi.ingredienti && pi.ingredienti.length
                            ? `<div style="font-size:0.75em; color:#555;">
                                Ingredienti: ${pi.ingredienti.map(i => `${i.nome}${i.qtyPerUnit ? ` (${i.qtyPerUnit}${i.unita || ""})` : ""}`).join(", ")}
                            </div>` : ""}
                    </div>
                `).join("")}
                ${piattiSnack.map(pi => `
                    <div>
                        ${pi.quantita}× ${pi.nome} (€${pi.prezzo.toFixed(2)})
                        ${pi.ingredienti && pi.ingredienti.length
                            ? `<div style="font-size:0.75em; color:#555;">
                                Ingredienti: ${pi.ingredienti.map(i => `${i.nome}${i.qtyPerUnit ? ` (${i.qtyPerUnit}${i.unita || ""})` : ""}`).join(", ")}
                            </div>` : ""}
                    </div>
                `).join("")}
                ${p.note ? `
                <div><i>Note: ${p.note}</i></div>
                ${window.settings.noteDestinazioniAbilitate ? `
                    <div style="margin-top:4px; font-size:0.85em;">
                        <b>Invia note a:</b>
                        ${["cucina","bere", ...(window.settings.snackAbilitato ? ["snack"] : [])].map(d => `
                            <label style="margin-right:10px;">
                                <input type="checkbox" class="note-destinazione" data-id="${id}" data-destinazione="${d}" ${p.noteDestinazioni?.includes(d) ? "checked" : ""}>
                                ${d.charAt(0).toUpperCase() + d.slice(1)}
                            </label>
                        `).join("")}
                    </div>
                ` : ""}
                ` : ""}

            </div>

            <div class="order-footer">
                <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                    <span>
                        <b>Totale: €${totale.toFixed(2)}</b>
                        ${p.restoRichiesto && p.restoRichiesto > 0 ? `<span style="margin-left:8px;">(Resto: €${p.restoRichiesto})</span>` : ""}
                    </span>

                    <div style="display:flex; align-items:center; gap:10px;">
                        ${window.settings.asportoAbilitato ? `
                            <label>
                                <input type="checkbox"
                                    onchange="segnaAsporto('${id}', this.checked)"
                                    ${p.asporto ? 'checked' : ''}/> Asporto
                            </label>
                        ` : ""}

                        <label>
                            <select onchange="impostaMetodoPagamento('${id}', this.value)">
                                <option value="contanti" ${p.metodoPagamento === 'contanti' ? 'selected' : ''}>Contanti</option>
                                <option value="pos" ${p.metodoPagamento === 'pos' ? 'selected' : ''}>POS</option>
                            </select>
                        </label>

                        <button class="aggiungi" onclick="aggiungiPreordineAlleComande('${id}')">Aggiungi</button>

                    </div>
                </div>
            </div>
            <div>
                ${p.asporto ? `<div style="font-weight:bold; color:#007b00; margin-top:4px;">📦 Asporto</div>` : ""}
                <div style="font-size:0.8em; color:#777; margin-top:4px;">
                    🕒 Preordine arrivato alle ${p.orario || ''}
                </div>
            </div>
        `;
        lista.appendChild(div);
    });

}

async function segnaAsporto(id, checked) {
    if (!window.settings.asportoAbilitato) return;
    const snap = await preordiniRef.child(id).once("value");
    if (!snap.exists()) return;
    await preordiniRef.child(id).update({ asporto: checked });
    notifypreordini(`📦 Preordine ${checked ? "segnato" : "rimosso"} come asporto!`, "info");
}
function impostaMetodoPagamento(id, metodo) {
    preordiniRef.child(id).update({ metodoPagamento: metodo });
}

// ===================== AGGIUNGI PREORDINE COME COMANDA =====================
async function aggiungiPreordineAlleComande(id) {
    const snap = await preordiniRef.child(id).once("value");
    if (!snap.exists()) return;
    const p = snap.val();

    // 1️⃣ Genera numero + lettera per la comanda
    const lettera = (window.settings?.letteraPreordini || "D").toUpperCase();
    const numeroBase = await getProssimoNumero(lettera);
    const numeroComandaFinale = numeroBase + lettera;

    // 2️⃣ Dividi i piatti per ruolo
    let piattiCucina = p.piatti?.filter(i => i.categoria !== "bevande" && i.categoria !== "snack") || [];
    let piattiBere = p.piatti?.filter(i => i.categoria === "bevande") || [];
    let piattiSnack = p.piatti?.filter(i => i.categoria === "snack") || [];

    // ✅ Se snack disabilitati, sposta in cucina
    if (!window.settings.snackAbilitato && piattiSnack.length > 0) {
        piattiCucina = [...piattiCucina, ...piattiSnack];
        piattiSnack = [];
    }

    // 3️⃣ Stati categorie
    const statoCucina = piattiCucina.length ? "da fare" : "completato";
    const statoBere = piattiBere.length ? "da fare" : "completato";
    const statoSnack = window.settings.snackAbilitato && piattiSnack.length ? "da fare" : "completato";

    // 4️⃣ noteDestinazioni
    let noteDestinazioni = ["cucina"];

    if (window.settings.noteDestinazioniAbilitate) {
        // Se attivo → manda note dove ci sono piatti reali
        if (piattiBere.length) noteDestinazioni.push("bere");
        if (window.settings.snackAbilitato && piattiSnack.length) noteDestinazioni.push("snack");
    }


    // 5️⃣ Commento asporto
    const commentoAsporto = (window.settings.asportoAbilitato && p.asporto) ? "ASPORTO" : null;

    // 6️⃣ Metodo pagamento predefinito
    const metodoPagamento = p.metodoPagamento || "contanti";


    // 7️⃣ Costruzione oggetto comanda
    const nuovaComanda = {
        numero: numeroComandaFinale,
        piatti: [
            ...piattiCucina.map(pi => ({ ...pi, destinazione: "cucina" })),
            ...piattiBere.map(pi => ({ ...pi, destinazione: "bere" })),
            ...piattiSnack.map(pi => ({ ...pi, destinazione: "snack" }))
        ],
        statoCucina,
        statoBere,
        ...(window.settings.snackAbilitato && { statoSnack }),
        timestamp: Date.now(),
        orario: new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }),
        note: p.note || "",
        noteDestinazioni,
        commento: commentoAsporto,
        metodoPagamento,
        preordine: true
    };

    // 8️⃣ Controllo duplicati
    const existing = await db.ref("comande")
        .orderByChild("numero")
        .equalTo(numeroComandaFinale)
        .once("value");
    if (existing.exists()) {
        notifypreordini(`❌ Comanda ${numeroComandaFinale} già presente!`, "error");
        return;
    }

    await db.ref("comande").push(nuovaComanda);
    await preordiniRef.child(id).remove();

    // 🔹 Rimuovi dal set dei preordini notificati così può suonare di nuovo
    window.comandeNotificate.delete(id);
    localStorage.setItem("comandeNotificate", JSON.stringify([...window.comandeNotificate]));

    // 🔹 Stampa automatica comanda se abilitata
    if (window.settings.stampaAutomaticaComande) {
        stampaComanda([...piattiCucina, ...piattiBere, ...piattiSnack], numeroComandaFinale, p.note || "", {
            nome: p.nome,
            telefono: p.telefono,
            posizione: p.posizione,
            nomeStand: window.settings.nomeStand,
            restoRichiesto: p.restoRichiesto
        });



    }

    // 🔟 Conferma visiva
    notifypreordini(`✅ Preordine ${numeroComandaFinale} aggiunto come comanda!`, "info");

}
async function eliminaPreordine(id) {
  await preordiniRef.child(id).remove();
  if (typeof notifypreordini === "function") notifypreordini("🗑️ Preordine eliminato.", "info");
}
async function getProssimoNumero(lettera) {
    // Prendi tutte le comande con la lettera selezionata
    const snap = await db.ref("comande").once("value");
    const data = snap.val() || {};

    let maxNum = 0;
    Object.values(data).forEach(c => {
        if (!c.numero) return;
        const match = c.numero.toString().match(/^(\d+)([A-Za-z])$/);
        if (match && match[2].toUpperCase() === lettera.toUpperCase()) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) maxNum = num;
        }
    });

    return maxNum + 1; // ritorna il prossimo numero disponibile
}
// ================================================================
// ========== 3️⃣ PARTE CLIENTI (pagina preordina.html) ============
// ================================================================
let totale = 0;
let menuItems = {};
async function initPreordiniClienti() {
    // 🔹 Controllo impostazioni preordini
    const snapImpostazioni = await db.ref("impostazioni/preordiniAbilitati").once("value");
    const preordiniAbilitati = snapImpostazioni.val() ?? true;
    window.settings.preordiniAbilitati = preordiniAbilitati;

    const inviaBtn = document.getElementById("inviaPreordineBtn");
    const menuDiv = document.getElementById("menuClienti");
    const orarioConsegnaInput = document.getElementById("orarioConsegnaCliente");


    if (menuDiv) menuDiv.style.visibility = "visible";

    if (!preordiniAbilitati) {
        if (inviaBtn) {
            inviaBtn.disabled = true;
            inviaBtn.innerText = "⚠ Preordini disabilitati";
        }
        if (menuDiv) menuDiv.innerHTML = "<p>I preordini sono disabilitati.</p>";
    } else {
        if (inviaBtn) {
            inviaBtn.disabled = false;
            inviaBtn.innerText = "📩 Invia Preordine";
        }
        if (menuDiv) menuDiv.innerHTML = "";
    }
  if (!menuDiv) return;

  totale = 0;

  // 🔹 Applica tema dal DB prima di mostrare tutto
  applicaTemaDaDatabase();
    // Legge la nuova impostazione
    const snapInfo = await db.ref("impostazioni/preordiniRichiediInfo").once("value");
    window.settings.preordiniRichiediInfo = snapInfo.exists() ? snapInfo.val() : false;

  // Carica menù
    Promise.all([
        db.ref("menu").once("value"),
        db.ref("ingredienti").once("value")
    ]).then(([snapMenu, snapIngredienti]) => {
        const menuData = snapMenu.val() || {};
        const ingredientiDB = snapIngredienti.val() || {};
        ingredientiGlobali = snapIngredienti.val() || {};
        menuDiv.innerHTML = "";

        // Ordina le chiavi dei menuItems in base alla categoria
        const categorieOrdine = ["cibi","snack","bevande"];
        menuItems = Object.fromEntries(
            Object.entries(menuData).sort(([, a], [, b]) => {
                const catA = a.categoria || "cibo";
                const catB = b.categoria || "cibo";
                return categorieOrdine.indexOf(catA) - categorieOrdine.indexOf(catB);
            })
        );


    categorieOrdine.forEach(cat => {
        const items = Object.entries(menuItems).filter(([id, i]) => (i.categoria || "cibi") === cat);
        if (items.length === 0) return;

        // Titolo categoria
        const titoloDiv = document.createElement("div");
        titoloDiv.className = "categoria-titolo";
        titoloDiv.innerHTML = `<h3>${cat === "cibo" ? "Cibo" : cat.charAt(0).toUpperCase() + cat.slice(1)}</h3>`;
        menuDiv.appendChild(titoloDiv);


        // Piatti della categoria
        items.forEach(([id, item]) => {
            const piattoBloccato = item.bloccato === true;
            let ingredientiEsauriti = false;
            if (item.ingredienti) {
                for (const ing of item.ingredienti) {
                    const dbIng = ingredientiDB[ing.id];
                    if (dbIng && dbIng.disponibile === false) {
                        ingredientiEsauriti = true;
                        break;
                    }
                }
            }
            const esaurito = piattoBloccato || ingredientiEsauriti;

            const riga = document.createElement("div");
            riga.className = "menu-item";
            if (esaurito) riga.classList.add("esaurito");
            riga.innerHTML = `
                <div class="menu-item-top" style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
                    <button style="padding: 5px 12px; font-size: 13px; font-weight: bold; border-radius: 50px; background: transparent; color: ${esaurito ? '#aaa' : '#4CAF50'}; border: 1.5px solid ${esaurito ? '#ddd' : '#4CAF50'}; cursor: ${esaurito ? 'not-allowed' : 'pointer'}; transition: 0.2s;" 
                        onclick="apriPopupPersonalizzaCliente('${id}')" ${esaurito ? "disabled" : ""}>
                        ${esaurito ? "Esaurito" : "+ Aggiungi"}
                    </button>
                    <span class="piatto-nome" style="flex:1;">${item.nome}</span>
                    <span class="piatto-prezzo">
                        ${
                            item.sconto && item.sconto.tipo === "percentuale"
                            ? `<span style="text-decoration: line-through; color:#888;">€${item.prezzo.toFixed(2)}</span>
                            <br>
                            <span style="font-weight:bold; color:#d9534f;">
                                    €${(item.prezzo * (1 - item.sconto.valore/100)).toFixed(2)}
                            </span>`
                            : `€${item.prezzo.toFixed(2)}`
                        }
                    </span>
                    ${esaurito ? `<span class="piatto-esaurito-label">❌ Non disponibile</span>` : ""}


                </div>
                ${item.sconto ? `<div class="piatto-sconto" style="color:#d9534f; font-weight:bold; font-size:0.9em; margin-left:35px;">
                    ${item.sconto.tipo === "percentuale" ? `${item.sconto.valore}% di sconto`
                    : item.sconto.tipo === "x_paga_y" ? `Prendi ${item.sconto.valore.x} Paga ${item.sconto.valore.y}`
                    : item.sconto.tipo === "x_paga_y_fisso" ? `Prendi ${item.sconto.valore.x} Paga €${item.sconto.valore.y.toFixed(2)}`
                    : ""}
                </div>` : ""}
                ${item.ingredienti && item.ingredienti.length ? `<div class="piatto-ingredienti" style="margin-left:10px; font-size:0.85em; color:#555;">
                    ${item.ingredienti.map(i => `${i.nome}${i.qtyPerUnit ? ` (${i.qtyPerUnit}${i.unita||""})`:""}`).join(", ")}
                </div>` : ""}
            `;
            menuDiv.appendChild(riga);
        });

    });

    document.querySelectorAll("select[data-id]").forEach(inp => {
      inp.addEventListener("change", aggiornaTotale);

    });
    menuDiv.style.visibility = "visible";
    
  });
    const telefonoInput = document.getElementById("telefonoCliente");
    telefonoInput.addEventListener("input", () => {
        let val = telefonoInput.value.replace(/\D/g, ""); // solo numeri

        if (val.length <= 8) {
            // Formato 1234 5678
            val = val.replace(/(\d{4})(\d{1,4})/, "$1 $2");
        } else {
            // Formato 123 456 7890
            val = val.replace(/(\d{3})(\d{3})(\d{1,4})/, "$1 $2 $3");
        }

        telefonoInput.value = val.trim();
    });


    const posizioneInput = document.getElementById("posizioneCliente");
    // ✅ Listener realtime per mostra/nascondi campi informazioni
    db.ref("impostazioni/preordiniRichiediInfo").on("value", snap => {
        const val = snap.exists() ? snap.val() : false;
        window.settings.preordiniRichiediInfo = val;
        if (orarioConsegnaInput) orarioConsegnaInput.parentElement.style.display = val ? "block" : "none";

        if (telefonoInput) telefonoInput.parentElement.style.display = val ? "block" : "none";
        if (posizioneInput) posizioneInput.parentElement.style.display = val ? "block" : "none";
    });
    if (window.settings.preordiniRichiediInfo) {
        if (telefonoInput) telefonoInput.parentElement.style.display = "block";
        if (posizioneInput) posizioneInput.parentElement.style.display = "block";
        if (orarioConsegnaInput) orarioConsegnaInput.parentElement.style.display = "block";
    } else {
        if (telefonoInput) telefonoInput.parentElement.style.display = "none";
        if (posizioneInput) posizioneInput.parentElement.style.display = "none";
        if (orarioConsegnaInput) orarioConsegnaInput.parentElement.style.display = "none";
    }

      function aggiornaRiepilogoCarrelloUI() {
        let nuovoTotale = 0;
        const listaCarrello = document.getElementById("listaCarrello");
        const carrelloContainer = document.getElementById("carrelloContainer");
        
        if (listaCarrello) listaCarrello.innerHTML = "";
        
        // Mostra o Nasconde magicamente il box del carrello se ci sono prodotti
        if (carrelloContainer) {
            carrelloContainer.style.display = carrelloCliente.length === 0 ? "none" : "block";
        }
    
        carrelloCliente.forEach((item, index) => {
            const costoRiga = item.prezzo + item.extraPrezzo;
            nuovoTotale += costoRiga;
            
            if (listaCarrello) {
                const divRiga = document.createElement("div");
                divRiga.style.padding = "10px 0";
                divRiga.style.borderBottom = "1px dashed #eee";
                divRiga.style.display = "flex";
                divRiga.style.justifyContent = "space-between";
                divRiga.style.alignItems = "center";
                
                // Creiamo il testo delle varianti (es: "+ Bacon \n - Senza Cipolla")
                let htmlVarianti = "";
                if (item.varianti && item.varianti.length > 0) {
                    htmlVarianti = `<div style="font-size: 0.8em; color: #777; margin-top: 4px;">
                        ${item.varianti.map(v => v.tipo === "aggiunta" ? `+ ${v.nome}` : `- Senza ${v.nome}`).join("<br>")}
                    </div>`;
                }
    
                // Disegniamo la riga del carrello con il tastino per cancellare
                divRiga.innerHTML = `
                    <div style="flex: 1; text-align: left;">
                        <b style="color: #333; font-size: 1.1em;">${item.nome}</b>
                        ${htmlVarianti}
                    </div>
                    <div style="font-weight: bold; margin-right: 15px; font-size: 1.1em; color: #4CAF50;">
                        €${costoRiga.toFixed(2)}
                    </div>
                    <button onclick="rimuoviDalCarrello(${index})" style="background: #fff; color: #ff5252; border: 1px solid #ff5252; border-radius: 8px; padding: 6px 12px; cursor: pointer; font-size: 0.9em; font-weight: bold; transition: 0.2s;">Rimuovi</button>
                `;
                listaCarrello.appendChild(divRiga);
            }
        });
    
        totale = Number(nuovoTotale.toFixed(2));
        const totaleSpan = document.getElementById("totaleCliente");
        if (totaleSpan) totaleSpan.innerText = totale.toFixed(2);
    }
    
    // Permette al cliente di cancellare un piatto se ci ha ripensato
    function rimuoviDalCarrello(index) {
        carrelloCliente.splice(index, 1);
        aggiornaRiepilogoCarrelloUI();
    }
    // Listener combinato ingredienti + bloccato
    function aggiornaDisponibilitaPiatti(menuData, ingredientiDB) {
        document.querySelectorAll(".menu-item").forEach(riga => {
            // Cerchiamo il bottone invece della vecchia select
            const btnAggiungi = riga.querySelector("button[onclick^='apriPopupPersonalizzaCliente']");
            const labelEsaurito = riga.querySelector(".piatto-esaurito-label");
            if (!btnAggiungi) return;

            // Estraiamo l'ID del piatto dalla funzione onclick
            const match = btnAggiungi.getAttribute('onclick').match(/'([^']+)'/);
            if (!match) return;
            const id = match[1];

            const item = menuData[id];
            if (!item) return;

            // Determina se il piatto è esaurito
            let esaurito = item.bloccato === true;
            if (item.ingredienti) {
                for (const ing of item.ingredienti) {
                    const dbIng = ingredientiDB[ing.id];
                    if (dbIng && dbIng.disponibile === false) {
                        esaurito = true;
                        break;
                    }
                }
            }

            if (esaurito) {
                riga.classList.add("esaurito");
                btnAggiungi.disabled = true;
                btnAggiungi.style.background = "#e0e0e0";
                btnAggiungi.style.color = "#999";
                btnAggiungi.style.border = "none";
                btnAggiungi.style.cursor = "not-allowed";
                btnAggiungi.innerText = "Esaurito";

                if (!labelEsaurito) {
                    const span = document.createElement("span");
                    span.className = "piatto-esaurito-label";
                    span.innerText = "❌ Non disponibile";
                    span.style.marginLeft = "10px";
                    riga.querySelector(".menu-item-top").appendChild(span);
                }
            } else {
                riga.classList.remove("esaurito");
                btnAggiungi.disabled = false;
                // Stile leggero e moderno
                btnAggiungi.style.background = "transparent";
                btnAggiungi.style.color = "#4CAF50";
                btnAggiungi.style.border = "2px solid #4CAF50";
                btnAggiungi.style.cursor = "pointer";
                btnAggiungi.innerText = "+ Aggiungi";

                if (labelEsaurito) labelEsaurito.remove();
            }
        });

        // Richiama la nuova funzione del carrello (se è già caricata in fondo al file)
        if (typeof aggiornaRiepilogoCarrelloUI === "function") {
            aggiornaRiepilogoCarrelloUI();
        }
    }
    // Listener realtime combinato
    db.ref("menu").on("value", snapMenu => {
        const menuData = snapMenu.val() || {};

        db.ref("ingredienti").once("value").then(snapIng => {
            const ingredientiDB = snapIng.val() || {};
            aggiornaDisponibilitaPiatti(menuData, ingredientiDB);
        });
    });

db.ref("ingredienti").on("value", snapIng => {
    const ingredientiDB = snapIng.val() || {};

    db.ref("menu").once("value").then(snapMenu => {
        const menuData = snapMenu.val() || {};
        aggiornaDisponibilitaPiatti(menuData, ingredientiDB);
    });
});


  function calcolaPrezzoPreordine(piatto) {
    const q = piatto.quantita || 1;
    if (!piatto.sconto) return Number(piatto.prezzo || 0) * q;

    const prezzo = Number(piatto.prezzo || 0);

    if (piatto.sconto.tipo === "percentuale") {
        return prezzo * q * (1 - (Number(piatto.sconto.valore) || 0) / 100);
    } else if (piatto.sconto.tipo === "x_paga_y") {
        const x = Number(piatto.sconto.valore.x || 1);
        const y = Number(piatto.sconto.valore.y || 1);
        const gruppi = Math.floor(q / x);
        const rimanenti = q % x;
        return (gruppi * y + rimanenti) * prezzo;
    } else if (piatto.sconto.tipo === "x_paga_y_fisso") {
        const x = Number(piatto.sconto.valore.x || 1);
        const y = Number(piatto.sconto.valore.y || prezzo);
        const gruppi = Math.floor(q / x);
        const rimanenti = q % x;
        return gruppi * y + rimanenti * prezzo;
    }

    return prezzo * q;
  }

  // 🔹 Disabilita "resto richiesto" se spunta "soldi giusti"
  const checkSoldi = document.getElementById("soldiGiusti");
  const inputResto = document.getElementById("restoRichiesto");
    checkSoldi.addEventListener("change", () => {
        inputResto.disabled = checkSoldi.checked;
        if (checkSoldi.checked) inputResto.value = "";
    });

    // 🔹 Accetta solo numeri
    inputResto.addEventListener("input", () => {
        inputResto.value = inputResto.value.replace(/[^0-9.]/g, "");
    });
  checkSoldi.addEventListener("change", () => {
    inputResto.disabled = checkSoldi.checked;
    if (checkSoldi.checked) inputResto.value = "";
  });

  // Invia preordine
  if (!inviaBtn) return;

    inviaBtn.onclick = async () => {

        if (!window.settings.preordiniAbilitati) {
            notifypreordini("⚠ Il sistema dei preordini è disabilitato.", "warn");
            return;
        }

        const nome = document.getElementById("nomeCliente").value.trim();
        const note = document.getElementById("noteCliente").value.trim();
        const haSoldiGiusti = document.getElementById("soldiGiusti").checked;
        const restoRichiesto = parseFloat(document.getElementById("restoRichiesto").value || 0);

        if (!nome) {
            notifypreordini("⚠ Inserisci il tuo nome!", "warn");
            return;
        }

        if (window.settings.preordiniRichiediInfo) {
            if (!telefonoInput.value.trim()) {
                notifypreordini("⚠ Inserisci il numero di telefono!", "warn");
                return;
            }
            if (!posizioneInput.value.trim()) {
                notifypreordini("⚠ Inserisci la posizione!", "warn");
                return;
            }
            // Controllo formato telefono
            const telefonoPulito = telefonoInput.value.replace(/\D/g, ""); // solo cifre
            if (!/^[0-9]{8,12}$/.test(telefonoPulito)) {
                notifypreordini("⚠ Inserisci un numero di telefono valido (solo numeri)!", "warn");
                return;
            }
            if (!orarioConsegnaInput.value.trim()) {
                notifypreordini("⚠ Inserisci l'orario di consegna!", "warn");
                return;
            }
        }

        // 🔹 Costruisci lista piatti
        const piatti = carrelloCliente.map(c => {
            return {
                nome: c.nome,
                prezzo: c.prezzo, // Questo è il prezzo base
                extraPrezzo: c.extraPrezzo,
                varianti: c.varianti,
                quantita: 1, // È sempre 1 perché ogni configurazione è unica
                categoria: c.categoria
            };
        });

        if (piatti.length === 0) {
            notifypreordini("⚠ Il carrello è vuoto!", "warn");
            return;
        }

        if (!haSoldiGiusti && (isNaN(restoRichiesto) || restoRichiesto <= 0)) {
            notifypreordini("⚠ Devi indicare soldi giusti o il resto!", "warn");
            return;
        }

        // ==================================================================
        // 🔥 INVECE DI INVIARE SUBITO → MOSTRO IL POPUP DI RIEPILOGO
        // ==================================================================
        let html = `<p><b>Nome:</b> ${nome}</p>`;
        if (window.settings.preordiniRichiediInfo) {
            html += `<p><b>Telefono:</b> ${telefonoInput.value}</p>`;
            html += `<p><b>Posizione:</b> ${posizioneInput.value}</p>`;
            html += `<p><b>Orario consegna:</b> ${orarioConsegnaInput.value || "-"}</p>`;

        }

        html += `<hr><h3>Piatti</h3>`;

        piatti.forEach(p => {
            html += `<div>${p.quantita}× ${p.nome} — €${p.prezzo.toFixed(2)}</div>`;
        });

        html += `<hr><p><b>Totale: €${totale.toFixed(2)}</b></p>`;
        if (note) html += `<p><i>Note: ${note}</i></p>`;
        if (restoRichiesto > 0) html += `<p>Resto richiesto: €${restoRichiesto}</p>`;

        document.getElementById("popupRiepilogoContenuto").innerHTML = html;
        document.getElementById("popupRiepilogo").classList.remove("hidden");

        // 🔹 SE CONFERMA INVIO
        document.getElementById("confermaInvioPreordine").onclick = async () => {

            // CREA L’OGGETTO COME PRIMA (identico!)
            const now = new Date();
            const orario = now.toLocaleTimeString("it-IT", { hour: '2-digit', minute: '2-digit' });

            const preordine = {
                nome,
                orario,
                piatti,
                totale,
                note,
                haSoldiGiusti,
                restoRichiesto,
                timestamp: Date.now(),
                stato: piatti.length ? "da fare" : "completato",
                ...(window.settings.preordiniRichiediInfo && {
                    telefono: telefonoInput.value.trim(),
                    posizione: posizioneInput.value.trim(),
                    orarioConsegna: orarioConsegnaInput.value || null
                })
            };

            try {
                await preordiniRef.push(preordine);

                mostraNotificaCentrale("✅ Preordine inviato!");

                // 🔹 Reset identico al tuo codice
                document.getElementById("nomeCliente").value = "";
                document.getElementById("noteCliente").value = "";
                document.getElementById("posizioneCliente").value = "";
                document.getElementById("telefonoCliente").value = "";
                document.getElementById("orarioConsegnaCliente").value = "";
                document.getElementById("soldiGiusti").checked = false;
                document.getElementById("restoRichiesto").value = "";
                document.getElementById("restoRichiesto").disabled = false;
                document.querySelectorAll("select[data-id]").forEach(sel => sel.value = "0");
                totale = 0;
                document.getElementById("totaleCliente").innerText = "0.00";

            } catch (err) {
                console.error(err);
                notifypreordini("❌ Errore nell'invio del preordine.", "critico");
            }

            document.getElementById("popupRiepilogo").classList.add("hidden");
        };

        document.getElementById("annullaInvioPreordine").onclick = () => {
            document.getElementById("popupRiepilogo").classList.add("hidden");
        };
    };
}

// ================================================================
// ========== AUTO-DETECT DEL CONTESTO ============================
// ================================================================
document.addEventListener("DOMContentLoaded", () => {
    listenTemaRealtime(); // listener tema

    // 🔹 Controllo preordini abilitati per tab
    db.ref("impostazioni/preordiniAbilitati").once("value").then(snap => {
        const preordiniAbilitati = snap.val() ?? true;

        const preordiniTabBtnCassa = document.getElementById("preordiniTabBtn");
        const preordiniTabBtnAdmin = document.getElementById("preordiniTabBtnAdmin");

        if (!preordiniAbilitati) {
            if (preordiniTabBtnCassa) preordiniTabBtnCassa.style.display = "none";
            if (preordiniTabBtnAdmin) preordiniTabBtnAdmin.style.display = "none";
        }
    });

    if (document.getElementById("menuClienti")) {
        initPreordiniClienti();
    } else {
        initPreordiniInterni();
    }
});
document.addEventListener("change", ev => {
    const target = ev.target;
    if (!target.classList.contains("note-destinazione")) return;

    const dest = target.dataset.destinazione;
    const idOrdine = target.dataset.id;

    preordiniRef.child(idOrdine).once("value").then(snap => {
        if (!snap.exists()) return;
        const p = snap.val();
        let destinazioni = p.noteDestinazioni || [];

        if (target.checked) {
            if (!destinazioni.includes(dest)) destinazioni.push(dest);
        } else {
            destinazioni = destinazioni.filter(d => d !== dest);
        }

        preordiniRef.child(idOrdine).update({ noteDestinazioni: destinazioni });
    });
});

document.getElementById("preordiniTabBtn")?.addEventListener("click", () => {
    document.getElementById("preordiniTabBtn")?.classList.remove("tab-lampeggia");
});
async function stampaComanda(items, numeroComanda, note = "", cliente = {}) {
    const { nome, telefono, posizione } = cliente;
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
        if (nome) { doc.text(`Cliente: ${nome}`, 10, y); y += 5; }
        if (telefono) { doc.text(`Telefono: ${telefono}`, 10, y); y += 5; }
        if (posizione) { doc.text(`Posizione: ${posizione}`, 10, y); y += 5; }
        if (cliente.restoRichiesto && cliente.restoRichiesto > 0) { 
            doc.text(`Resto richiesto: €${cliente.restoRichiesto}`, 10, y); 
            y += 5; 
        }

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
function notifypreordini(msg, type = "info", playSoundFlag = false) {
    const div = document.createElement("div");
    div.className = `toast preordineToast ${type}`;

    // Applica stile unificato tramite CSS invece di inline
    // Posizione e colori saranno gestiti dalle classi .toast.preordineToast.info/warn/error
    div.innerText = msg;
    document.body.appendChild(div);

    requestAnimationFrame(() => {
        div.style.opacity = "1";
    });

    // Scomparsa automatica
    setTimeout(() => {
        div.style.opacity = "0";
        setTimeout(() => div.remove(), 500);
    }, 4000);

    // Suono opzionale
    if (playSoundFlag && type === "info" && window.settings?.suonoCassa) {
        playSound("nuovo_preordine");
    }

    div.innerText = msg;
    document.body.appendChild(div);

    requestAnimationFrame(() => {
        div.style.opacity = "1";
    });

    // Scomparsa automatica
    setTimeout(() => {
        div.style.opacity = "0";
        setTimeout(() => div.remove(), 500);
    }, 4000);

    // Suono opzionale
    if (playSoundFlag && type === "info" && window.settings?.suonoCassa) {
        playSound("nuovo_preordine");
    }
}
function mostraNotificaCentrale(msg) {
    const box = document.getElementById("notificaCentrale");
    box.innerHTML = msg;
    box.classList.remove("hidden");

    requestAnimationFrame(() => {
        box.classList.add("show");
    });

    setTimeout(() => {
        box.classList.remove("show");
        setTimeout(() => box.classList.add("hidden"), 400);
    }, 1500);
}
// ===================== PLAY SOUND DINAMICO =====================
function playSound(nome) {
    if (!window.AudioContext) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    function playTone(frequency, duration, type = "sine", when = 0) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(frequency, ctx.currentTime + when);
        gain.gain.setValueAtTime(0.1, ctx.currentTime + when);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime + when);
        osc.stop(ctx.currentTime + when + duration);
    }

    if (nome === "nuovo_preordine") {
        const toni = [
            { freq: 880, dur: 0.15, type: "sine" },
            { freq: 1046, dur: 0.15, type: "square" },
            { freq: 1318, dur: 0.2, type: "triangle" }
        ];

        toni.forEach((tono, i) => {
            playTone(tono.freq, tono.dur, tono.type, i * 0.2);
        });
    }
}
document.addEventListener('DOMContentLoaded', () => {
    const standDisplay = document.getElementById('nome-stand-display');

    firebase.database().ref('impostazioni/nomeStand').once('value')
        .then((snapshot) => {
            const nomeStand = snapshot.val();
            if (nomeStand && standDisplay) {
                standDisplay.textContent = nomeStand;
            }
        })
        .catch((error) => {
            console.error("Errore nel recupero del nome stand:", error);
        });
});
let tempVariantiCliente = [];
let idPiattoInModifica = null;

function apriPopupPersonalizzaCliente(id) {
    const piatto = menuItems[id];
    if (!piatto) return;

    idPiattoInModifica = id;
    tempVariantiCliente = [];
    
    const popup = document.getElementById("popupPersonalizzaCliente");
    const maxGratis = piatto.maxVariantiGratis || 0;
    const testoGratis = maxGratis > 0 ? `<br><small style="color:green; font-size:0.7em;">Hai ${maxGratis} aggiunte GRATIS su questo prodotto!</small>` : "";
    
    document.getElementById("titoloPersonalizza").innerHTML = `Personalizza: ${piatto.nome} ${testoGratis}`;
    popup.style.display = "flex";

    renderVariantiCliente(piatto, maxGratis);
}

function chiudiPopupPersonalizza() {
    document.getElementById("popupPersonalizzaCliente").style.display = "none";
}

function renderVariantiCliente(piatto, maxGratis) {
    const listaDiv = document.getElementById("listaIngredientiCliente");
    listaDiv.innerHTML = "";

    // Calcolo Intelligente del Prezzo Extra (Stesso cervello della cassa!)
    let totaleExtra = 0;
    const aggiunte = tempVariantiCliente.filter(v => v.tipo === "aggiunta");
    aggiunte.forEach((v, index) => {
        if (index >= maxGratis) totaleExtra += Number(v.prezzo || 0);
    });

    // Aggiorna il totale in tempo reale nel popup
    const prezzoBaseScontato = calcolaPrezzoConScontoPerPiattoSingolo(piatto); 
    document.getElementById("totalePiattoPersonalizzato").innerText = (prezzoBaseScontato + totaleExtra).toFixed(2);

    const isProssimaGratis = aggiunte.length < maxGratis;
    const baseIds = (piatto.ingredienti || []).map(i => i.id);

    Object.entries(ingredientiGlobali).forEach(([ingId, ing]) => {
        const catsApp = ing.categorieApplicabili || [ing.categoria || "cibi"];
        const catPiatto = (piatto.categoria || "cibi").toLowerCase();
        if (!catsApp.includes(catPiatto) && !baseIds.includes(ingId)) return;

        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";
        row.style.padding = "10px 0";
        row.style.borderBottom = "1px solid #eee";

        const nomeSpan = document.createElement("span");
        nomeSpan.innerText = ing.nome;
        const btnContainer = document.createElement("div");

        // RIMOZIONE (Per togliere ingredienti base)
        if (baseIds.includes(ingId)) {
            const isRimosso = tempVariantiCliente.some(v => v.tipo === "rimozione" && v.id === ingId);
            const btnRemove = document.createElement("button");
            btnRemove.innerText = isRimosso ? "Annulla" : "- Togli";
            btnRemove.style.cssText = isRimosso ? "background:#ccc; padding:5px 10px; border-radius:5px;" : "background:#ff9800; color:white; padding:5px 10px; border-radius:5px; border:none;";
            btnRemove.onclick = () => {
                if (isRimosso) tempVariantiCliente = tempVariantiCliente.filter(v => !(v.tipo === "rimozione" && v.id === ingId));
                else tempVariantiCliente.push({ tipo: "rimozione", id: ingId, nome: ing.nome });
                renderVariantiCliente(piatto, maxGratis);
            };
            btnContainer.appendChild(btnRemove);
        }

        // AGGIUNTA
        const costoExtra = ing.prezzoExtra !== undefined ? Number(ing.prezzoExtra) : 0.50; 
        const isAggiunto = tempVariantiCliente.some(v => v.tipo === "aggiunta" && v.id === ingId);
        
        const btnAdd = document.createElement("button");
        btnAdd.style.marginLeft = "5px";
        if (isAggiunto) {
            btnAdd.innerText = "Annulla";
            btnAdd.style.cssText += "background:#ccc; padding:5px 10px; border-radius:5px; border:none;";
            btnAdd.onclick = () => {
                tempVariantiCliente = tempVariantiCliente.filter(v => !(v.tipo === "aggiunta" && v.id === ingId));
                renderVariantiCliente(piatto, maxGratis);
            };
        } else {
            btnAdd.innerText = isProssimaGratis ? `+ Aggiungi (GRATIS)` : `+ Aggiungi (€${costoExtra.toFixed(2)})`;
            btnAdd.style.cssText += "background:#4CAF50; color:white; padding:5px 10px; border-radius:5px; border:none;";
            btnAdd.onclick = () => {
                tempVariantiCliente.push({ tipo: "aggiunta", id: ingId, nome: ing.nome, prezzo: costoExtra });
                renderVariantiCliente(piatto, maxGratis);
            };
        }
        btnContainer.appendChild(btnAdd);

        row.appendChild(nomeSpan);
        row.appendChild(btnContainer);
        listaDiv.appendChild(row);
    });

    // Azione del tasto SALVA
    document.getElementById("btnConfermaPersonalizzazione").onclick = () => {
        carrelloCliente.push({
            id: idPiattoInModifica,
            nome: piatto.nome,
            prezzo: prezzoBaseScontato, // Usiamo il prezzo già eventualmente scontato
            categoria: piatto.categoria,
            varianti: JSON.parse(JSON.stringify(tempVariantiCliente)),
            extraPrezzo: totaleExtra,
            quantita: 1 // Nel carrello ogni elemento configurato vale 1
        });
        
        chiudiPopupPersonalizza();
        aggiornaRiepilogoCarrelloUI(); // Funzione che disegneremo per mostrare il totale
    };
}

// Calcola lo sconto per la singola unità
function calcolaPrezzoConScontoPerPiattoSingolo(piatto) {
    let p = Number(piatto.prezzo || 0);
    if (piatto.sconto && piatto.sconto.tipo === "percentuale") {
        p = p * (1 - (Number(piatto.sconto.valore) || 0) / 100);
    }
    return p;
}
// ==========================================
// FUNZIONI DEL CARRELLO VISIVO (CLIENTE)
// ==========================================

function aggiornaRiepilogoCarrelloUI() {
    let nuovoTotale = 0;
    const listaCarrello = document.getElementById("listaCarrello");
    const carrelloContainer = document.getElementById("carrelloContainer");
    
    if (listaCarrello) listaCarrello.innerHTML = "";
    
    // Mostra o Nasconde magicamente il box del carrello se ci sono prodotti
    if (carrelloContainer) {
        carrelloContainer.style.display = carrelloCliente.length === 0 ? "none" : "block";
    }

    carrelloCliente.forEach((item, index) => {
        const costoRiga = item.prezzo + item.extraPrezzo;
        nuovoTotale += costoRiga;
        
        if (listaCarrello) {
            const divRiga = document.createElement("div");
            divRiga.style.padding = "10px 0";
            divRiga.style.borderBottom = "1px dashed #eee";
            divRiga.style.display = "flex";
            divRiga.style.justifyContent = "space-between";
            divRiga.style.alignItems = "center";
            
            // Creiamo il testo delle varianti (es: "+ Bacon \n - Senza Cipolla")
            let htmlVarianti = "";
            if (item.varianti && item.varianti.length > 0) {
                htmlVarianti = `<div style="font-size: 0.8em; color: #777; margin-top: 4px;">
                    ${item.varianti.map(v => v.tipo === "aggiunta" ? `+ ${v.nome}` : `- Senza ${v.nome}`).join("<br>")}
                </div>`;
            }

            // Disegniamo la riga del carrello con il tastino per cancellare
            divRiga.innerHTML = `
                <div style="flex: 1; text-align: left;">
                    <b style="color: #333; font-size: 1.1em;">${item.nome}</b>
                    ${htmlVarianti}
                </div>
                <div style="font-weight: bold; margin-right: 15px; font-size: 1.1em; color: #4CAF50;">
                    €${costoRiga.toFixed(2)}
                </div>
                <button onclick="rimuoviDalCarrello(${index})" style="background: #fff; color: #ff5252; border: 1px solid #ff5252; border-radius: 8px; padding: 6px 12px; cursor: pointer; font-size: 0.9em; font-weight: bold; transition: 0.2s;">Rimuovi</button>
            `;
            listaCarrello.appendChild(divRiga);
        }
    });

    totale = Number(nuovoTotale.toFixed(2));
    const totaleSpan = document.getElementById("totaleCliente");
    if (totaleSpan) totaleSpan.innerText = totale.toFixed(2);
}

// Permette al cliente di cancellare un piatto se ci ha ripensato
function rimuoviDalCarrello(index) {
    carrelloCliente.splice(index, 1);
    aggiornaRiepilogoCarrelloUI();
}
