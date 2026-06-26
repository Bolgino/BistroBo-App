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
            piattiCibo.push(...piattiSnack);
            piattiSnack = [];
        }
        
        function formattaPrezzoSingolo(pi) {
            if (typeof calcolaPrezzoConSconto === "function") {
                return (calcolaPrezzoConSconto(pi) / (pi.quantita || 1)).toFixed(2);
            }
            return (Number(pi.prezzo || 0) + Number(pi.extraPrezzo || 0)).toFixed(2);
        }

        let totale = 0;
        [...piattiCibo, ...piattiBere, ...piattiSnack].forEach(pi => {
            if (typeof calcolaPrezzoConSconto === "function") {
                totale += calcolaPrezzoConSconto(pi);
            } else {
                totale += (Number(pi.prezzo || 0) + Number(pi.extraPrezzo || 0)) * (pi.quantita || 1);
            }
        });
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
                        ${pi.quantita}× ${pi.nome} (€${formattaPrezzoSingolo(pi)})
                        ${pi.ingredienti && pi.ingredienti.length
                            ? `<div style="font-size:0.75em; color:#555;">
                                Ingredienti: ${pi.ingredienti.map(i => `${i.nome}${i.qtyPerUnit ? ` (${i.qtyPerUnit}${i.unita || ""})` : ""}`).join(", ")}
                            </div>`
                            : ""}
                        ${pi.contorniScelti && pi.contorniScelti.length 
                            ? `<div style="font-size:0.85em; color:#d9534f; font-weight:bold; margin-top:3px;">
                                Contorni: ${pi.contorniScelti.map(c => c.nome).join(" + ")}
                               </div>`
                            : ""}
                    </div>
                `).join("")}
                ${piattiBere.map(pi => `
                    <div>
                        ${pi.quantita}× ${pi.nome} (€${formattaPrezzoSingolo(pi)})
                        ${pi.ingredienti && pi.ingredienti.length
                            ? `<div style="font-size:0.75em; color:#555;">
                                Ingredienti: ${pi.ingredienti.map(i => `${i.nome}${i.qtyPerUnit ? ` (${i.qtyPerUnit}${i.unita || ""})` : ""}`).join(", ")}
                            </div>`
                            : ""}
                        ${pi.contorniScelti && pi.contorniScelti.length 
                            ? `<div style="font-size:0.85em; color:#d9534f; font-weight:bold; margin-top:3px;">
                                Contorni: ${pi.contorniScelti.map(c => c.nome).join(" + ")}
                               </div>`
                            : ""}
                    </div>
                `).join("")}
                ${piattiSnack.map(pi => `
                    <div>
                        ${pi.quantita}× ${pi.nome} (€${formattaPrezzoSingolo(pi)})
                        ${pi.ingredienti && pi.ingredienti.length
                            ? `<div style="font-size:0.75em; color:#555;">
                                Ingredienti: ${pi.ingredienti.map(i => `${i.nome}${i.qtyPerUnit ? ` (${i.qtyPerUnit}${i.unita || ""})` : ""}`).join(", ")}
                            </div>`
                            : ""}
                        ${pi.contorniScelti && pi.contorniScelti.length 
                            ? `<div style="font-size:0.85em; color:#d9534f; font-weight:bold; margin-top:3px;">
                                Contorni: ${pi.contorniScelti.map(c => c.nome).join(" + ")}
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
                        ${pi.quantita}× ${pi.nome} (€${formattaPrezzoSingolo(pi)})
                        ${pi.ingredienti && pi.ingredienti.length
                            ? `<div style="font-size:0.75em; color:#555;">
                                Ingredienti: ${pi.ingredienti.map(i => `${i.nome}${i.qtyPerUnit ? ` (${i.qtyPerUnit}${i.unita || ""})` : ""}`).join(", ")}
                            </div>`
                            : ""}
                        ${pi.contorniScelti && pi.contorniScelti.length 
                            ? `<div style="font-size:0.85em; color:#d9534f; font-weight:bold; margin-top:3px;">
                                Contorni: ${pi.contorniScelti.map(c => c.nome).join(" + ")}
                               </div>`
                            : ""}
                    </div>
                `).join("")}
                ${piattiBere.map(pi => `
                    <div>
                       ${pi.quantita}× ${pi.nome} (€${formattaPrezzoSingolo(pi)})
                        ${pi.ingredienti && pi.ingredienti.length
                            ? `<div style="font-size:0.75em; color:#555;">
                                Ingredienti: ${pi.ingredienti.map(i => `${i.nome}${i.qtyPerUnit ? ` (${i.qtyPerUnit}${i.unita || ""})` : ""}`).join(", ")}
                            </div>`
                            : ""}
                        ${pi.contorniScelti && pi.contorniScelti.length 
                            ? `<div style="font-size:0.85em; color:#d9534f; font-weight:bold; margin-top:3px;">
                                Contorni: ${pi.contorniScelti.map(c => c.nome).join(" + ")}
                               </div>`
                            : ""}
                    </div>
                `).join("")}
                ${piattiSnack.map(pi => `
                    <div>
                        ${pi.quantita}× ${pi.nome} (€${formattaPrezzoSingolo(pi)})
                        ${pi.ingredienti && pi.ingredienti.length
                            ? `<div style="font-size:0.75em; color:#555;">
                                Ingredienti: ${pi.ingredienti.map(i => `${i.nome}${i.qtyPerUnit ? ` (${i.qtyPerUnit}${i.unita || ""})` : ""}`).join(", ")}
                            </div>`
                            : ""}
                        ${pi.contorniScelti && pi.contorniScelti.length 
                            ? `<div style="font-size:0.85em; color:#d9534f; font-weight:bold; margin-top:3px;">
                                Contorni: ${pi.contorniScelti.map(c => c.nome).join(" + ")}
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

// ===================== AGGIUNGI PREORDINE COME COMANDA E SCALA INGREDIENTI =====================
async function aggiungiPreordineAlleComande(id) {
    const snap = await preordiniRef.child(id).once("value");
    if (!snap.exists()) return;
    const p = snap.val();

    // 1️⃣ Genera numero + lettera per la comanda
    const lettera = (window.settings?.letteraPreordini || "D").toUpperCase();
    const numeroBase = await getProssimoNumero(lettera);
    const numeroComandaFinale = numeroBase + lettera;

    // 🔥 2️⃣ SCALA INGREDIENTI DAL MAGAZZINO (Come fa la Cassa!)
    // Dobbiamo estrarre la funzione di calcolo dal file principale (se esiste) o calcolarli.
    if (typeof calcolaRichiesteDaPiatti === "function" && typeof applicaDecrementiIngredienti === "function") {
        const richieste = calcolaRichiesteDaPiatti(p.piatti || []);
        const resIng = await applicaDecrementiIngredienti(richieste);
        if (!resIng.success) {
            notifypreordini("❌ Errore scalo magazzino: " + (resIng.message || "ingredienti insufficienti"), "error");
            // Scegli tu se bloccare la comanda (return) o mandarla comunque. Solitamente si manda comunque con avviso:
        }
    }

    // 3️⃣ Usa separaComanda per capire chi deve preparare cosa, dividendo perfettamente i contorni
    const { cibo, bere, snack } = separaComanda(p.piatti || []);

    // 4️⃣ Stati categorie
    const statoCucina = cibo.length > 0 ? "da fare" : "completato";
    const statoBere = bere.length > 0 ? "da fare" : "completato";
    const statoSnack = window.settings.snackAbilitato && snack.length > 0 ? "da fare" : "completato";

    // 5️⃣ noteDestinazioni
    let noteDestinazioni = ["cucina"];
    if (window.settings.noteDestinazioniAbilitate) {
        if (bere.length > 0) noteDestinazioni.push("bere");
        if (window.settings.snackAbilitato && snack.length > 0) noteDestinazioni.push("snack");
    }

    // 6️⃣ Commento asporto
    const commentoAsporto = (window.settings.asportoAbilitato && p.asporto) ? "ASPORTO" : null;

    // 7️⃣ Metodo pagamento predefinito
    const metodoPagamento = p.metodoPagamento || "contanti";

    // 8️⃣ Costruzione oggetto comanda
    const nuovaComanda = {
        numero: numeroComandaFinale,
        piatti: p.piatti || [],
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

    // 9️⃣ Controllo duplicati
    const existing = await db.ref("comande").orderByChild("numero").equalTo(numeroComandaFinale).once("value");
    if (existing.exists()) {
        notifypreordini(`❌ Comanda ${numeroComandaFinale} già presente!`, "error");
        return;
    }

    // Salvataggio ed eliminazione dal preordine
    await db.ref("comande").push(nuovaComanda);
    await preordiniRef.child(id).remove();

    window.comandeNotificate.delete(id);
    localStorage.setItem("comandeNotificate", JSON.stringify([...window.comandeNotificate]));

    // Stampa automatica comanda se abilitata
    if (window.settings.stampaAutomaticaComande && typeof stampaComanda === "function") {
        const datiDellaStampa = {
            nome: p.nome,
            telefono: p.telefono,
            posizione: p.posizione,
            nomeStand: window.settings.nomeStand,
            restoRichiesto: p.restoRichiesto
        };
        stampaComanda(p.piatti || [], numeroComandaFinale, p.note || "", datiDellaStampa);
    }

    notifypreordini(`✅ Preordine ${numeroComandaFinale} confermato e ingredienti scalati!`, "info");
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
   

    // 🟢 AGGIUNGI QUESTE DUE RIGHE ESATTAMENTE QUI:
    const snapExtra = await db.ref("impostazioni/sistemaExtraAbilitato").once("value");
    window.settings.sistemaExtraAbilitato = snapExtra.exists() ? snapExtra.val() : true;
    // FAI CAPIRE A PREORDINI SE LE COMBO SONO ON O OFF
    const snapCombo = await db.ref("impostazioni/piattiComboAbilitati").once("value");
    window.settings.piattiComboAbilitati = snapCombo.exists() ? snapCombo.val() : false;
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

            // Crea il contenitore principale
            const riga = document.createElement("div");
            riga.className = "menu-item";
            if (esaurito) riga.classList.add("esaurito");
            
            // 1. Parte superiore (Nome + Prezzo scontato)
            const topDiv = document.createElement("div");
            topDiv.className = "menu-item-top";
            topDiv.style.display = "flex";
            topDiv.style.justifyContent = "center"; // 🔥 Centra forzatamente il contenitore
            topDiv.style.alignItems = "center";
            topDiv.style.position = "relative";     // 🔥 Necessario per incollare il prezzo a destra
            topDiv.style.minHeight = "35px";        // Previene sfasamenti
            
            const prezzoHtml = item.sconto && item.sconto.tipo === "percentuale"
                ? `<span style="text-align: right; display:inline-block;">
                    <span style="text-decoration: line-through; color:#888; font-size: 0.9em;">€${item.prezzo.toFixed(2)}</span><br>
                    <span style="font-weight:bold; color:#d9534f;">€${(item.prezzo * (1 - item.sconto.valore / 100)).toFixed(2)}</span>
                   </span>`
                : `<span>€${item.prezzo.toFixed(2)}</span>`;
            
            // 🔥 Posizionamento Assoluto per il prezzo: rimane a destra senza spingere il titolo fuori centro!
            topDiv.innerHTML = `
                <span class="piatto-nome" style="font-weight:bold; text-align:center; padding:0 50px;">${item.nome}</span>
                <span class="piatto-prezzo" style="position:absolute; right:0; top:50%; transform:translateY(-50%);">${prezzoHtml}</span>
            `;
            
            // 2. Sconto e Ingredienti
            let dettagliDiv = "";
            
            // Aggiunta label sconto se presente
            if (item.sconto) {
                dettagliDiv += `<div class="piatto-sconto" style="color:#d9534f; text-align:center; font-weight:bold; font-size:0.85em; margin-bottom: 5px;">
                    ${item.sconto.tipo === "percentuale" ? `${item.sconto.valore}% di sconto`
                    : item.sconto.tipo === "x_paga_y" ? `Prendi ${item.sconto.valore.x} Paga ${item.sconto.valore.y}`
                    : item.sconto.tipo === "x_paga_y_fisso" ? `Prendi ${item.sconto.valore.x} Paga €${item.sconto.valore.y.toFixed(2)}`
                    : ""}
                </div>`;
            }
            
            // Aggiunta ingredienti
            if (item.ingredienti && item.ingredienti.length) {
                dettagliDiv += `<div class="piatto-ingredienti" style="text-align:center; font-size:0.85em; color:#555; margin-bottom: 10px;">
                    ${item.ingredienti.map(i => `${i.nome}${i.qtyPerUnit ? ` (${i.qtyPerUnit}${i.unita||""})`:""}`).join(", ")}
                </div>`;
            }
            
            // 3. Bottone dinamico Intelligente
            let clickAction = "";
            if (item.isCombo && window.settings.piattiComboAbilitati) {
                // Se è una combo, apre il modale per scegliere i contorni
                clickAction = `apriPopupComboCliente('${id}')`; 
            } else {
                // 🔥 FIX MODALE: Aggiunta rapida al carrello! (Niente popup extra qui)
                // Gli extra si apriranno SOLO cliccando il nome del piatto dentro il carrello.
                clickAction = `aggiungiVeloceCarrello('${id}')`; 
            }
            
            const btnHtml = `
                <button id="btn-add-${id}" style="width: 100%; padding: 8px; border-radius: 8px; border: 1.5px solid ${esaurito ? '#ccc' : '#4CAF50'}; background: transparent; color: ${esaurito ? '#aaa' : '#4CAF50'}; cursor: ${esaurito ? 'not-allowed' : 'pointer'}; font-weight: bold; transition: all 0.3s ease;" 
                    onclick="${clickAction}" ${esaurito ? "disabled" : ""}>
                    ${esaurito ? "❌ Esaurito" : "+ Aggiungi"}
                </button>`;
            
            // Assemblaggio finale
            riga.appendChild(topDiv);
            riga.insertAdjacentHTML('beforeend', dettagliDiv);
            riga.insertAdjacentHTML('beforeend', btnHtml);
            
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
   
    // Permette al cliente di cancellare un piatto se ci ha ripensato
    function rimuoviDalCarrello(index) {
        carrelloCliente.splice(index, 1);
        aggiornaRiepilogoCarrelloUI();
    }
    // Listener combinato ingredienti + bloccato
    function aggiornaDisponibilitaPiatti(menuData, ingredientiDB) {
        document.querySelectorAll(".menu-item").forEach(riga => {
            // Cerchiamo il bottone intercettando tutte le possibili azioni di click
            const btnAggiungi = riga.querySelector("button[onclick^='apriPopupPersonalizzaCliente'], button[onclick^='aggiungiVeloceCarrello'], button[onclick^='apriPopupCombo']");
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
window.aggiungiVeloceCarrello = function(id) {
    const piatto = menuItems[id];
    if (!piatto) return;
    
    carrelloCliente.push({
        id: id,
        nome: piatto.nome,
        prezzo: piatto.prezzo, // 🔥 Usiamo sempre il prezzo puro per permettere i calcoli 3x2
        sconto: piatto.sconto || null, // 🔥 Fondamentale per i 3x2
        categoria: piatto.categoria,
        ingredienti: piatto.ingredienti ? JSON.parse(JSON.stringify(piatto.ingredienti)) : [],
        varianti: [], 
        contorniScelti: [],
        extraPrezzo: 0,
        quantita: 1,
        maxVariantiGratis: piatto.maxVariantiGratis || 0
    });
    
    if (typeof aggiornaRiepilogoCarrelloUI === "function") aggiornaRiepilogoCarrelloUI();
};

  // ASSICURATI DI AVERE QUESTA MATEMATICA SUL LATO CLIENTI PER GLI SCONTI!
    function calcolaPrezzoPreordine(piatto) { 
        const q = piatto.quantita || 1; 
        const prezzoBaseEExtra = (piatto.prezzo + (piatto.extraPrezzo || 0));
    
        if (!piatto.sconto) return prezzoBaseEExtra * q;
    
        if (piatto.sconto.tipo === "percentuale") {
            return prezzoBaseEExtra * q * (1 - piatto.sconto.valore/100);
        } else if (piatto.sconto.tipo === "x_paga_y") {
            const x = parseInt(piatto.sconto.valore.x);
            const y = parseInt(piatto.sconto.valore.y);
            return (Math.floor(q / x) * y + (q % x)) * prezzoBaseEExtra;
        } else if (piatto.sconto.tipo === "x_paga_y_fisso") {
            const x = parseInt(piatto.sconto.valore.x);
            const y = parseFloat(piatto.sconto.valore.y);
            return (Math.floor(q / x) * y) + (q % x) * prezzoBaseEExtra;
        }
        return prezzoBaseEExtra * q;
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

        // 🔹 Costruisci lista piatti MANTENENDO CONTORNI E VARIANTI
        const piatti = carrelloCliente.map(c => {
            return {
                nome: c.nome,
                prezzo: c.prezzo,
                extraPrezzo: c.extraPrezzo || 0,
                varianti: c.varianti || [],
                contorniScelti: c.contorniScelti || [],
                ingredienti: c.ingredienti || [],
                quantita: 1, // È sempre 1 perché ogni configurazione è unica
                categoria: c.categoria,
                isCombo: c.isCombo || false,
                maxVariantiGratis: c.maxVariantiGratis || 0
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
// ==========================================
// FUNZIONI DEL CARRELLO VISIVO (CLIENTE)
// ==========================================

function calcolaPrezzoConScontoPerPiatto(piatto, comandaIntera) {
    const q = piatto.quantita || 1;
    
    // 1. Sommiamo tutti i costi extra dei contorni (Prezzo base del contorno + le sue varianti a pagamento)
    let costoContorni = 0;
    if (piatto.contorniScelti && piatto.contorniScelti.length > 0) {
        piatto.contorniScelti.forEach(c => costoContorni += (c.prezzoPagato || 0) + (c.extraPrezzo || 0));
    }
    
    // 2. Prezzo totale grezzo della singola riga
    const prezzoRigaSenzaSconto = (piatto.prezzo || 0) + (piatto.extraPrezzo || 0) + costoContorni;

    if(!piatto.sconto) return prezzoRigaSenzaSconto * q;

    // 3. Sconto percentuale applicato SOLAMENTE sul prezzo base del piatto (non sugli extra)
    if(piatto.sconto.tipo === "percentuale"){
        const scontoNetto = (piatto.prezzo || 0) * ((Number(piatto.sconto.valore)||0)/100);
        return (prezzoRigaSenzaSconto - scontoNetto) * q;
    } 

    // 4. Sconti 3x2, ecc..
    if(piatto.sconto.tipo === "x_paga_y" || piatto.sconto.tipo === "x_paga_y_fisso"){
        // Conta quante volte compare questo stesso ID in tutto il carrello preordini
        let qTotale = comandaIntera.filter(p => p.id === piatto.id).length;
        const x = parseInt(piatto.sconto.valore.x);

        if (qTotale < x) return prezzoRigaSenzaSconto * q; // Soglia non raggiunta

        const numGruppi = Math.floor(qTotale / x);
        const resto = qTotale % x;

        let costoScontatoIntero = 0;
        if (piatto.sconto.tipo === "x_paga_y") {
            const y = parseInt(piatto.sconto.valore.y);
            costoScontatoIntero = (numGruppi * y * piatto.prezzo) + (resto * piatto.prezzo);
        } else { 
            const y = parseFloat(piatto.sconto.valore.y);
            costoScontatoIntero = (numGruppi * y) + (resto * piatto.prezzo);
        }

        const costoTotaleBase = qTotale * piatto.prezzo;
        const scontoTotale = costoTotaleBase - costoScontatoIntero;

        // Ritorniamo il prezzo della riga sottraendo la quota parte di sconto calcolata per questa unità
        return (prezzoRigaSenzaSconto * q) - ((q / qTotale) * scontoTotale);
    }
    return prezzoRigaSenzaSconto * q;
}
function aggiornaRiepilogoCarrelloUI() {
    let nuovoTotale = 0;
    let totaleGrezzo = 0;
    const listaCarrello = document.getElementById("listaCarrello");
    const carrelloContainer = document.getElementById("carrelloContainer");

    if (listaCarrello) listaCarrello.innerHTML = "";
    if (carrelloContainer) carrelloContainer.style.display = carrelloCliente.length === 0 ? "none" : "block";

    if (listaCarrello && carrelloCliente.length > 0 && window.settings.sistemaExtraAbilitato) {
         listaCarrello.innerHTML = "<div style='font-size:0.85em; color:#777; font-style:italic; margin-bottom:5px; text-align:center;'>Clicca sul nome di un piatto o di un contorno per aggiungere o togliere ingredienti.</div>";
    }

    carrelloCliente.forEach((item, index) => {
        // 🔥 FIX TOTALI: Calcolo corretto del costo grezzo della riga includendo i contorni pagati extra
        let costoContorniPagati = 0;
        if (item.contorniScelti && item.contorniScelti.length > 0) {
            item.contorniScelti.forEach(c => costoContorniPagati += (c.prezzoPagato || 0));
        }
        
        const costoRigaGrezzo = (item.prezzo || 0) + (item.extraPrezzo || 0) + costoContorniPagati;
        const costoRigaScontato = calcolaPrezzoConScontoPerPiatto(item, carrelloCliente);
        
        totaleGrezzo += costoRigaGrezzo;
        nuovoTotale += costoRigaScontato;

        if (listaCarrello) {
            const divRiga = document.createElement("div");
            divRiga.style.padding = "10px 0"; divRiga.style.borderBottom = "1px dashed #eee";
            divRiga.style.display = "flex"; divRiga.style.justifyContent = "space-between";
            divRiga.style.alignItems = "center"; divRiga.style.gap = "15px";

            let htmlVarianti = "";
            if (item.varianti && item.varianti.length > 0) {
                let conteggio = {};
                item.varianti.forEach(v => {
                    let key = v.tipo + "_" + v.nome;
                    if (!conteggio[key]) conteggio[key] = { tipo: v.tipo, nome: v.nome, count: 0 };
                    conteggio[key].count++;
                });
                const variantiTxt = Object.values(conteggio).map(v => {
                    let qTxt = v.count > 1 ? `${v.count}x ` : "";
                    return v.tipo === "aggiunta" ? `<span style="color:green;">+ ${qTxt}${v.nome}</span>` : `<span style="color:red;">- Senza ${v.nome}</span>`;
                }).join("<br>");
                htmlVarianti = `<div style="font-size: 0.8em; color: #777; margin-top: 4px;">${variantiTxt}</div>`;
            }
            
            let htmlCombo = "";
            if (item.contorniScelti && item.contorniScelti.length > 0) {
                const cTxt = item.contorniScelti.map((c, cIdx) => {
                    let varsTxt = c.varianti && c.varianti.length > 0 ? " <small style='color:#777;'>(" + c.varianti.map(v => v.tipo==='aggiunta'?`+${v.nome}`:`-${v.nome}`).join(", ") + ")</small>" : "";
                    
                    const clickStr = window.settings.sistemaExtraAbilitato ? `onclick="apriPopupVariantiContornoCliente(${index}, ${cIdx})"` : "";
                    const curStr = window.settings.sistemaExtraAbilitato ? "cursor:pointer; text-decoration:underline;" : "cursor:default;";

                    return c.isGratis 
                        ? `<span style="color:#2e7d32; font-weight:bold; ${curStr}" ${clickStr}>↳ ${c.nome}${varsTxt}</span>` 
                        : `<span style="color:#555; ${curStr}" ${clickStr}>↳ ${c.nome} (+€${c.prezzoPagato.toFixed(2)})${varsTxt}</span>`;
                }).join("<br>");
                htmlCombo = `<div style="font-size: 0.85em; margin-top: 4px;">${cTxt}</div>`;
            }

            const onclickStr = window.settings.sistemaExtraAbilitato ? `onclick="apriPopupPersonalizzaClienteModifica(${index})"` : "";
            const cursorStr = window.settings.sistemaExtraAbilitato ? "cursor: pointer; text-decoration: underline;" : "cursor: default;";

            divRiga.innerHTML = `
                <div style="flex: 1 1 auto; text-align: left; padding-right: 15px; word-break: break-word;">
                    <b ${onclickStr} style="color: #333; font-size: 1.1em; ${cursorStr}" title="${window.settings.sistemaExtraAbilitato ? 'Clicca per personalizzare' : ''}">${item.nome}</b>
                    ${htmlVarianti}
                    ${htmlCombo}
                </div>
                <div style="flex: 0 0 auto; font-weight: bold; font-size: 1.1em; color: #4CAF50; white-space: nowrap; margin-right: 15px;">
                    €${costoRigaGrezzo.toFixed(2)}
                </div>
                <button onclick="rimuoviDalCarrello(${index})" style="flex: 0 0 auto; background: #fff; color: #ff5252; border: 1px solid #ff5252; border-radius: 8px; padding: 6px 12px; cursor: pointer; font-size: 0.9em; font-weight: bold; transition: 0.2s; white-space: nowrap;">Rimuovi</button>
            `;
            listaCarrello.appendChild(divRiga);
        }
    });

    totale = Number(nuovoTotale.toFixed(2));
    
    // 🔥 FIX SCONTI UI: Mostriamo il riepilogo "Sconto Applicato" se c'è un risparmio
    const risparmio = totaleGrezzo - totale;
    if (risparmio > 0.01 && listaCarrello) {
        const divSconto = document.createElement("div");
        divSconto.style.padding = "10px 0"; divSconto.style.color = "#d32f2f";
        divSconto.style.fontWeight = "bold"; divSconto.style.textAlign = "right";
        divSconto.innerHTML = `Sconto Applicato (Offerte): -€${risparmio.toFixed(2)}`;
        listaCarrello.appendChild(divSconto);
    }

    const totaleSpan = document.getElementById("totaleCliente");
    if (totaleSpan) totaleSpan.innerText = totale.toFixed(2);
    
    if (typeof menuItems !== 'undefined') {
        Object.keys(menuItems).forEach(id => {
            const btn = document.getElementById(`btn-add-${id}`);
            if (btn && !btn.disabled && !btn.innerText.includes("Esaurito")) { 
                const count = carrelloCliente.filter(item => item.id === id).length;
                if (count > 0) { btn.innerHTML = `✅ Aggiunto (${count})`; btn.style.background = "#e8f5e9"; } 
                else { btn.innerHTML = `+ Aggiungi`; btn.style.background = "transparent"; }
            }
        });
    }
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
window.apriPopupPersonalizzaClienteModifica = function(idxCarrello) {
    const piattoCarrello = carrelloCliente[idxCarrello];
    const piattoMenu = menuItems[piattoCarrello.id];
    if (!piattoMenu) return;

    idPiattoInModifica = idxCarrello; // ⚠️ Qui salviamo l'INDICE NUMERICO del carrello
    tempVariantiCliente = JSON.parse(JSON.stringify(piattoCarrello.varianti || []));
    
    const popup = document.getElementById("popupPersonalizzaCliente");
    const maxGratis = piattoMenu.maxVariantiGratis || 0;
    const testoGratis = maxGratis > 0 ? `<br><small style="color:green; font-size:0.7em;">Hai ${maxGratis} aggiunte GRATIS su questo prodotto!</small>` : "";
    
    document.getElementById("titoloPersonalizza").innerHTML = `Modifica: ${piattoCarrello.nome} ${testoGratis}`;
    popup.style.display = "flex";

    renderVariantiCliente(piattoMenu, maxGratis);
};
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

    // Calcolo Intelligente del Prezzo Extra
    let totaleExtra = 0;
    const aggiunte = tempVariantiCliente.filter(v => v.tipo === "aggiunta");
    aggiunte.forEach((v, index) => {
        if (index >= maxGratis) totaleExtra += Number(v.prezzo || 0);
    });

    const prezzoBaseScontato = calcolaPrezzoConScontoPerPiattoSingolo(piatto); 
    document.getElementById("totalePiattoPersonalizzato").innerText = (prezzoBaseScontato + totaleExtra).toFixed(2);

    const aggiunteFatte = tempVariantiCliente.filter(v => v.tipo === "aggiunta").length;
    const isProssimaGratis = aggiunteFatte < maxGratis;
    const baseIds = (piatto.ingredienti || []).map(i => i.id);

    Object.entries(ingredientiGlobali).forEach(([ingId, ing]) => {
        const catsApp = ing.categorieApplicabili || [ing.categoria || "cibi"];
        const catPiatto = (piatto.categoria || "cibi").toLowerCase();
        
        const isBase = baseIds.includes(ingId);
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
        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";
        row.style.padding = "10px 0";
        row.style.borderBottom = "1px solid #eee";

        const nomeSpan = document.createElement("span");
        nomeSpan.innerText = ing.nome;
        const btnContainer = document.createElement("div");
        btnContainer.style.display = "flex";
        btnContainer.style.alignItems = "center";

        // RIMOZIONE 
        if (allowRemove) {
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

        // AGGIUNTA MULTIPLA
        if (allowAdd) {
            const costoExtra = ing.prezzoExtra !== undefined ? Number(ing.prezzoExtra) : 0.50;
            const qtyExtra = ing.qtyExtra !== undefined ? Number(ing.qtyExtra) : 1;
            
            const occorrenze = tempVariantiCliente.filter(v => v.tipo === "aggiunta" && v.id === ingId).length;

            const wrapperAdd = document.createElement("div");
            wrapperAdd.style.display = "inline-flex";
            wrapperAdd.style.alignItems = "center";
            wrapperAdd.style.marginLeft = "5px";

            if (occorrenze > 0) {
                // Tasto Meno
                const btnMinus = document.createElement("button");
                btnMinus.innerText = "-";
                btnMinus.style.cssText = "background:#ccc; color:black; padding:4px 10px; border-radius:5px; border:none;";
                btnMinus.onclick = () => {
                    const reversedIndex = [...tempVariantiCliente].reverse().findIndex(v => v.tipo === "aggiunta" && v.id === ingId);
                    if (reversedIndex !== -1) {
                        const indexToRemove = tempVariantiCliente.length - 1 - reversedIndex;
                        tempVariantiCliente.splice(indexToRemove, 1);
                    }
                    renderVariantiCliente(piatto, maxGratis);
                };

                const spanCount = document.createElement("span");
                spanCount.innerText = occorrenze;
                spanCount.style.margin = "0 8px";
                spanCount.style.fontWeight = "bold";

                // Tasto Più
                const btnPlus = document.createElement("button");
                btnPlus.innerText = "+";
                btnPlus.style.cssText = "background:#4CAF50; color:white; padding:4px 10px; border-radius:5px; border:none;";
                btnPlus.onclick = () => {
                    tempVariantiCliente.push({ tipo: "aggiunta", id: ingId, nome: ing.nome, qty: qtyExtra, prezzo: costoExtra });
                    renderVariantiCliente(piatto, maxGratis);
                };

                wrapperAdd.appendChild(btnMinus);
                wrapperAdd.appendChild(spanCount);
                wrapperAdd.appendChild(btnPlus);
            } else {
                // Tasto Aggiungi iniziale
                const btnAdd = document.createElement("button");
                btnAdd.innerText = isProssimaGratis ? `+ Aggiungi (GRATIS)` : `+ Aggiungi (€${costoExtra.toFixed(2)})`;
                btnAdd.style.cssText = "background:#4CAF50; color:white; padding:5px 10px; border-radius:5px; border:none;";
                btnAdd.onclick = () => {
                    tempVariantiCliente.push({ tipo: "aggiunta", id: ingId, nome: ing.nome, qty: qtyExtra, prezzo: costoExtra });
                    renderVariantiCliente(piatto, maxGratis);
                };
                wrapperAdd.appendChild(btnAdd);
            }
            btnContainer.appendChild(wrapperAdd);
        }

        row.appendChild(nomeSpan);
        row.appendChild(btnContainer);
        listaDiv.appendChild(row);
    });

    document.getElementById("btnConfermaPersonalizzazione").onclick = () => {
        let extraFinali = 0;
        tempVariantiCliente.filter(v => v.tipo === "aggiunta").forEach((v, index) => {
            if (index >= maxGratis) extraFinali += Number(v.prezzo || 0);
        });

        if (typeof idPiattoInModifica === "number") {
            // MODIFICA PIATTO ESISTENTE NEL CARRELLO
            carrelloCliente[idPiattoInModifica].varianti = tempVariantiCliente;
            carrelloCliente[idPiattoInModifica].extraPrezzo = extraFinali;
        } else {
            // AGGIUNTA COME PIATTO NUOVO
            carrelloCliente.push({
                id: idPiattoInModifica, // Salva l'ID Firebase originale per gli sconti
                nome: piatto.nome,
                prezzo: piatto.prezzo, 
                sconto: piatto.sconto || null, // 🔥 Manteniamo lo sconto!
                categoria: piatto.categoria,
                ingredienti: piatto.ingredienti ? JSON.parse(JSON.stringify(piatto.ingredienti)) : [],
                varianti: tempVariantiCliente,
                contorniScelti: [],
                extraPrezzo: extraFinali,
                quantita: 1,
                maxVariantiGratis: piatto.maxVariantiGratis || 0
            });
        }
        
        chiudiPopupPersonalizza();
        aggiornaRiepilogoCarrelloUI();  
    };
}
// Calcola lo sconto per la singola unità
function calcolaPrezzoConScontoPerPiattoSingolo(piatto) {
    if (!piatto) return 0;
    // Cerca il prezzo in vari campi possibili a seconda se è Piatto o Contorno
    let p = Number(piatto.prezzo !== undefined ? piatto.prezzo : (piatto.prezzoOriginale !== undefined ? piatto.prezzoOriginale : 0));
    if (piatto.sconto && piatto.sconto.tipo === "percentuale") {
        p = p * (1 - (Number(piatto.sconto.valore) || 0) / 100);
    }
    return p;
}
window.apriPopupVariantiContornoCliente = function(idxCarrello, idxContorno) {
    const piattoPadre = carrelloCliente[idxCarrello];
    const contorno = piattoPadre.contorniScelti[idxContorno];
    const piattoOriginale = menuItems[contorno.id];
    if (!piattoOriginale) return;

    if (!contorno.varianti) contorno.varianti = [];
    let tempVariantiCliente = JSON.parse(JSON.stringify(contorno.varianti));

    const popup = document.getElementById("popupPersonalizzaCliente");
    const maxGratis = piattoOriginale.maxVariantiGratis || 0;
    const testoGratis = maxGratis > 0 ? `<br><small style="color:green; font-size:0.7em;">Hai ${maxGratis} aggiunte GRATIS su questo prodotto!</small>` : "";
    document.getElementById("titoloPersonalizza").innerHTML = `Personalizza: ${contorno.nome} ${testoGratis}`;
    popup.style.display = "flex";

    function renderVariantiContorno() {
        const listaDiv = document.getElementById("listaIngredientiCliente");
        listaDiv.innerHTML = "";
        let totaleExtra = 0;
        tempVariantiCliente.filter(v => v.tipo === "aggiunta").forEach((v, index) => {
            if (index >= maxGratis) totaleExtra += Number(v.prezzo || 0);
        });

        document.getElementById("totalePiattoPersonalizzato").innerText = (piattoOriginale.prezzo + totaleExtra).toFixed(2);
        const aggiunteFatte = tempVariantiCliente.filter(v => v.tipo === "aggiunta").length;
        const isProssimaGratis = aggiunteFatte < maxGratis;

        const baseIds = (piattoOriginale.ingredienti || []).map(i => i.id).filter(id => id);
        const baseNomi = (piattoOriginale.ingredienti || []).map(i => (i.nome || "").trim().toLowerCase());

        Object.entries(ingredientiGlobali || {}).forEach(([ingId, ing]) => {
            const catsApp = ing.categorieApplicabili || [ing.categoria || "cibi"];
            let catPiatto = (piattoOriginale.categoria || "cibi").toLowerCase();
            if (catPiatto === "cucina") catPiatto = "cibi";

            const isBase = baseIds.includes(ingId) || baseNomi.includes((ing.nome || "").trim().toLowerCase());
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
            row.className = "ingrediente-row-cliente";
            row.style.cssText = "display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid #eee;";
            
            const nomeSpan = document.createElement("span");
            nomeSpan.innerText = ing.nome;
            nomeSpan.style.fontWeight = "bold";

            const btnContainer = document.createElement("div");
            btnContainer.style.display = "flex"; btnContainer.style.alignItems = "center";

            if (allowRemove) {
                const isRimosso = tempVariantiCliente.some(v => v.tipo === "rimozione" && v.id === ingId);
                const btnRemove = document.createElement("button");
                btnRemove.innerText = isRimosso ? "Annulla" : "- Togli";
                btnRemove.style.cssText = isRimosso ? "background:#ccc; padding:5px 10px; border-radius:5px;" : "background:#ff9800; color:white; padding:5px 10px; border-radius:5px; border:none;";
                btnRemove.onclick = () => {
                    if (isRimosso) tempVariantiCliente = tempVariantiCliente.filter(v => !(v.tipo === "rimozione" && v.id === ingId));
                    else tempVariantiCliente.push({ tipo: "rimozione", id: ingId, nome: ing.nome });
                    // 🔥 FIX: Chiama la funzione corretta senza parametri!
                    renderVariantiContorno();
                };
                btnContainer.appendChild(btnRemove);
            }

            if (allowAdd) {
                const costoExtra = ing.prezzoExtra !== undefined ? Number(ing.prezzoExtra) : 0.50;
                const occorrenze = tempVariantiCliente.filter(v => v.tipo === "aggiunta" && v.id === ingId).length;
                const wrapperAdd = document.createElement("div"); wrapperAdd.style.cssText = "display:inline-flex; align-items:center; margin-left:5px;";

                if (occorrenze > 0) {
                    const btnMinus = document.createElement("button"); btnMinus.innerText = "-"; btnMinus.style.cssText = "background:#ccc; padding:4px 10px; border-radius:5px; border:none;";
                    btnMinus.onclick = () => {
                        const rIndex = [...tempVariantiCliente].reverse().findIndex(v => v.tipo === "aggiunta" && v.id === ingId);
                        if (rIndex !== -1) tempVariantiCliente.splice(tempVariantiCliente.length - 1 - rIndex, 1);
                        // 🔥 FIX: Chiama la funzione corretta senza parametri!
                        renderVariantiContorno();
                    };
                    const spanCount = document.createElement("span"); spanCount.innerText = occorrenze; spanCount.style.cssText = "margin:0 8px; font-weight:bold;";
                    const btnPlus = document.createElement("button"); btnPlus.innerText = "+"; btnPlus.style.cssText = "background:#4CAF50; color:white; padding:4px 10px; border-radius:5px; border:none;";
                    btnPlus.onclick = () => { tempVariantiCliente.push({ tipo: "aggiunta", id: ingId, nome: ing.nome, qty: 1, prezzo: costoExtra }); renderVariantiContorno(); }; // 🔥 FIX

                    wrapperAdd.appendChild(btnMinus); wrapperAdd.appendChild(spanCount); wrapperAdd.appendChild(btnPlus);
                } else {
                    const btnAdd = document.createElement("button");
                    btnAdd.innerText = isProssimaGratis ? `+ Gratis` : `+ €${costoExtra.toFixed(2)}`;
                    btnAdd.style.cssText = "background:#4CAF50; color:white; padding:5px 10px; border-radius:5px; border:none;";
                    btnAdd.onclick = () => { tempVariantiCliente.push({ tipo: "aggiunta", id: ingId, nome: ing.nome, qty: 1, prezzo: costoExtra }); renderVariantiContorno(); }; // 🔥 FIX
                    wrapperAdd.appendChild(btnAdd);
                }
                btnContainer.appendChild(wrapperAdd);
            }
            row.appendChild(nomeSpan); row.appendChild(btnContainer); listaDiv.appendChild(row);
        });
    }

    renderVariantiContorno();

    // 🔥 FIX: Salva l'extra SOLO nel contorno!
    const btnSalva = document.getElementById("btnConfermaPersonalizzazione");
    if(btnSalva) {
        btnSalva.onclick = () => {
            contorno.varianti = tempVariantiCliente;
            let ext = 0;
            tempVariantiCliente.filter(v => v.tipo === "aggiunta").forEach((v, idx) => { 
                if (idx >= maxGratis) ext += Number(v.prezzo || 0); 
            });
            contorno.extraPrezzo = ext; 

            chiudiPopupPersonalizza();
            aggiornaRiepilogoCarrelloUI();
        };
    }

    const btnAnnulla = document.getElementById("btnAnnullaPersonalizzazione");
    if(btnAnnulla) {
        btnAnnulla.onclick = () => { chiudiPopupPersonalizza(); };
    }
} // <-- fine funzione apriPopupVariantiContornoCliente
    
// separa comanda in cibo/snack e bevande (VERSIONE DEFINITIVA)
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
        // Troviamo la destinazione del Piatto Principale (es. Panino -> Cibo)
        const destMain = getDest(i.categoria, i.tipo, i.nome);

        // Prepariamo il clone del piatto principale
        let cloneMain = JSON.parse(JSON.stringify({ ...i, isMainHere: true, contorniScelti: [] }));

        // Controlliamo eventuali contorni
        if (i.contorniScelti && i.contorniScelti.length > 0) {
            i.contorniScelti.forEach(c => {
                const destC = getDest(c.categoria, c.tipo, c.nome);

                if (destC !== destMain) {
                    // IL CONTORNO VA IN UN'ALTRA STAZIONE (es. Patatine in Snack) -> Creiamo un piatto perfetto indipendente!
                    let varTxt = c.varianti && c.varianti.length > 0 ? " (" + c.varianti.map(v => v.tipo==='aggiunta'?`+${v.nome}`:`-${v.nome}`).join(", ") + ")" : "";
                    
                    const splitItem = {
                        id: (i.id || "cont") + "_split_" + Math.random().toString(36).substr(2, 5),
                        id_univoco: "split_" + Math.random().toString(36).substr(2, 9),
                        nome: `${c.nome}${varTxt} [di ${i.nome}]`,
                        prezzo: 0,
                        quantita: i.quantita || 1,
                        categoria: destC === "snack" ? "Snack" : "Cibo",
                        tipo: destC,
                        isCombo: false,     // Fondamentale per non farlo trattare come menu
                        isMainHere: true,   // Fondamentale: impedisce la barretta "-"
                        varianti: [],
                        contorniScelti: [], 
                        ingredienti: [],
                        note: i.note || ""
                    };

                    if (destC === "snack") snack.push(splitItem);
                    if (destC === "cibo") cibo.push(splitItem);
                    if (destC === "bere") bere.push(splitItem);
                } else {
                    // IL CONTORNO VA NELLA STESSA STAZIONE -> Lo lasciamo attaccato al genitore
                    cloneMain.contorniScelti.push(c);
                }
            });
        }

        // Infine, inseriamo il piatto principale nella sua stazione
        if (destMain === "cibo") cibo.push(cloneMain);
        if (destMain === "bere") bere.push(cloneMain);
        if (destMain === "snack") snack.push(cloneMain);
    });

    return { cibo, bere, snack };
}

// Permette al cliente di cancellare un piatto se ci ha ripensato
function rimuoviDalCarrello(index) {
    carrelloCliente.splice(index, 1);
    aggiornaRiepilogoCarrelloUI();
}
// ================= GESTIONE PIATTI COMBO CLIENTI =================
let statoComboCliente = { piattoId: null, contorniSelezionati: [] };

window.chiudiPopupCombo = function() {
    const p = document.getElementById("popupCombo");
    if(p) p.style.display = "none";
};

// Questa è la funzione corretta cercata dal click del bottone "Aggiungi"
window.apriPopupComboCliente = function(id) {
    const piatto = menuItems[id];
    if (!piatto) return;

    statoComboCliente = { piattoId: id, contorniSelezionati: [] };
    const titoloEl = document.getElementById("titoloCombo");
    if(titoloEl) titoloEl.innerText = `Scegli i contorni per: ${piatto.nome}`;
    
    const popupEl = document.getElementById("popupCombo");
    if(popupEl) popupEl.style.display = "flex";

    renderListaPiattiComboCliente(piatto);
};

function renderListaPiattiComboCliente(piattoCombo) {
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
    Object.entries(menuItems || {}).forEach(([pId, p]) => {
        if (arrayIDValidi.includes(pId) && !p.bloccato) {
            piattiAmmessi.push({ id: pId, ...p });
        }
    });

    if (piattiAmmessi.length === 0) {
        listaDiv.innerHTML = "<p>Nessun contorno disponibile al momento.</p>";
    }

    // Calcolo intelligente dei prezzi extra dei contorni oltre la soglia gratuita
    let contorniPagamento = statoComboCliente.contorniSelezionati.slice(maxGratis);
    let gruppiPagamento = {};
    contorniPagamento.forEach(c => {
        const key = c.id || c.nome;
        if (!gruppiPagamento[key]) gruppiPagamento[key] = { ...c, count: 0 };
        gruppiPagamento[key].count++;
    });

    let totaleExtra = 0;
    Object.values(gruppiPagamento).forEach(g => {
        const pOriginale = menuItems[g.id] || {};
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

    const quantitaTotaleScelta = statoComboCliente.contorniSelezionati.length;

    piattiAmmessi.forEach(pAmmesso => {
        const occorrenze = statoComboCliente.contorniSelezionati.filter(c => c.id === pAmmesso.id).length;
        
        let prezzoDaMostrare = pAmmesso.prezzo;
        if (pAmmesso.sconto && pAmmesso.sconto.tipo === "percentuale") {
            prezzoDaMostrare -= (prezzoDaMostrare * (pAmmesso.sconto.valore / 100));
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
            <div style="flex:1; text-align: left;"><b>${pAmmesso.nome}</b> <small style="color:#777;">(€${pAmmesso.prezzo.toFixed(2)})</small></div>
            <div style="display:flex; align-items:center; gap:8px;">
                ${occorrenze > 0 ? `
                    <button onclick="rimuoviContornoComboCliente('${pAmmesso.id}')" style="background:#ccc; border:none; padding:5px 12px; border-radius:6px; font-weight:bold; cursor:pointer;">-</button>
                    <span style="font-weight:bold;">${occorrenze}</span>
                ` : ''}
                <button onclick="aggiungiContornoComboCliente('${pAmmesso.id}')" style="background:#4CAF50; color:white; border:none; padding:5px 10px; border-radius:6px; font-weight:bold; cursor:pointer;">${occorrenze > 0 ? '+' : btnPrezzoTxt}</button>
            </div>
        `;
        listaDiv.appendChild(row);
    });

    const btnConferma = document.getElementById("btnConfermaCombo");
    if(btnConferma) {
        btnConferma.onclick = () => {
            chiudiPopupCombo();
            let contorniDaSalvare = [];
            statoComboCliente.contorniSelezionati.forEach((c, index) => {
                contorniDaSalvare.push({
                    id: c.id, 
                    nome: c.nome,
                    prezzoOriginale: c.prezzoBase,
                    prezzoPagato: (index >= maxGratis) ? c.prezzoBase : 0, 
                    isGratis: (index < maxGratis),
                    categoria: menuItems[c.id]?.categoria || "cibi"
                });
            });

            const prezzoBaseScontato = calcolaPrezzoConScontoPerPiattoSingolo(piattoCombo); 

            // Inseriamo il piatto combo configurato nel carrello dei preordini
            carrelloCliente.push({
                id: piattoCombo.id || statoComboCliente.piattoId,
                nome: piattoCombo.nome, 
                prezzo: prezzoBaseScontato, 
                categoria: piattoCombo.categoria,
                ingredienti: piattoCombo.ingredienti ? JSON.parse(JSON.stringify(piattoCombo.ingredienti)) : [],
                varianti: [], 
                extraPrezzo: totaleExtra, 
                quantita: 1, 
                maxVariantiGratis: piattoCombo.maxVariantiGratis || 0,
                contorniScelti: contorniDaSalvare,
                sconto: piattoCombo.sconto || null 
            });
            
            if (typeof aggiornaRiepilogoCarrelloUI === "function") {
                aggiornaRiepilogoCarrelloUI();
            }
        };
    }
}

window.aggiungiContornoComboCliente = function(idPiattino) {
    const p = menuItems[idPiattino];
    if (!p) return;
    statoComboCliente.contorniSelezionati.push({ 
        id: idPiattino, 
        nome: p.nome, 
        prezzoBase: p.prezzo 
    });
    renderListaPiattiComboCliente(menuItems[statoComboCliente.piattoId]);
};

window.rimuoviContornoComboCliente = function(idPiattino) {
    const arr = statoComboCliente.contorniSelezionati;
    const index = arr.map(e => e.id).lastIndexOf(idPiattino);
    if (index > -1) arr.splice(index, 1);
    renderListaPiattiComboCliente(menuItems[statoComboCliente.piattoId]);
};
