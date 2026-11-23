import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "memobox_ai_react_v1";
const DAY_MS = 86400000;
const BOX_DELAYS = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 14 };

function uid() {
  return "id_" + Math.random().toString(36).slice(2, 10);
}

function normalizeText(str, strictAccents = true) {
  let s = (str || "").toLowerCase().trim().replace(/[.,!?;:()"'«»]/g, "");
  if (!strictAccents) {
    s = s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d");
  } else {
    s = s.normalize("NFC");
  }
  return s.replace(/\s+/g, " ");
}

function createCard(raw, defaultLang = "vi-VN") {
  return {
    id: raw.id || uid(),
    front: {
      text: raw.front?.text || raw.front || "",
      lang: raw.front?.lang || raw.targetLang || defaultLang,
      subtext: raw.front?.subtext || "",
    },
    back: {
      text: raw.back?.text || raw.back || "",
      lang: raw.back?.lang || "fr-FR",
      subtext: raw.back?.subtext || "",
    },
    toneHint: raw.toneHint || "",
    hint: raw.hint || "",
    example: raw.example || "",
    isMinimalPair: Boolean(raw.isMinimalPair),
    bidirectional: raw.bidirectional !== false,
    progress: raw.progress || {
      frontToBack: { box: 1, validated: false, nextReview: 0 },
      backToFront: { box: 1, validated: false, nextReview: 0 },
      nextDirection: "frontToBack",
    },
  };
}

function getDefaultData() {
  return {
    decks: [
      {
        id: "deck_vi_tones",
        title: "Vietnamien du Nord - Tons & Paires minimales",
        mode: "longTerm",
        selected: true,
        cards: [
          createCard({
            front: "má",
            back: "maman (Nord) / joue",
            toneHint: "Thanh sắc - ton aigu montant (voix qui monte)",
            hint: "Pense à 'ma' dit avec surprise vers le haut",
            example: "Má ơi, con về rồi.",
            isMinimalPair: true,
            bidirectional: true,
          }),
          createCard({
            front: "mà",
            back: "mais / qui / dont",
            toneHint: "Thanh huyền - ton grave descendant doux",
            hint: "Voix posée qui descend doucement",
            example: "Cái này rẻ mà tốt.",
            isMinimalPair: true,
            bidirectional: true,
          }),
          createCard({
            front: "mả",
            back: "tombe / sépulture",
            toneHint: "Thanh hỏi - ton plongeant puis remontant",
            hint: "Creuse puis remonte légèrement",
            example: "Thăm mả tổ tiên.",
            isMinimalPair: true,
            bidirectional: true,
          }),
          createCard({
            front: "mã",
            back: "cheval / code",
            toneHint: "Thanh ngã - ton cassé montant (coup de glotte au milieu)",
            hint: "Petite coupure de voix au milieu puis montée",
            example: "Mã QR.",
            isMinimalPair: true,
            bidirectional: true,
          }),
          createCard({
            front: "mạ",
            back: "jeune pousse de riz",
            toneHint: "Thanh nặng - ton bas et bref avec coup de glotte final",
            hint: "Grave, court, coupé net en bas",
            example: "Nhổ mạ cấy lúa.",
            isMinimalPair: true,
            bidirectional: true,
          }),
        ],
      },
    ],
  };
}

function isCardMastered(card) {
  const f = card.progress.frontToBack;
  const b = card.progress.backToFront;
  if (!card.bidirectional) return f.validated && f.box >= 3;
  return f.validated && b.validated && f.box >= 3 && b.box >= 3;
}

function isCardDue(card, mode) {
  if (mode === "sprint") return !isCardMastered(card);
  const now = Date.now();
  const dir = card.progress.nextDirection || "frontToBack";
  const dirState = card.progress[dir];
  return (dirState.nextReview || 0) <= now;
}

function speakText(text, lang = "vi-VN") {
  if (!("speechSynthesis" in window) || !text) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = lang;
  const voices = window.speechSynthesis.getVoices();
  const match =
    voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(lang.split("-")[0].toLowerCase()));
  if (match) utter.voice = match;
  window.speechSynthesis.speak(utter);
}

export default function App() {
  const [data, setData] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore storage errors
    }
    return getDefaultData();
  });

  const [tab, setTab] = useState("decks");
  const [onlyMinimalPairs, setOnlyMinimalPairs] = useState(false);
  const [listenMode, setListenMode] = useState(false);

  // État de session
  const [session, setSession] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [hintUsed, setHintUsed] = useState(false);
  const [strictAccents, setStrictAccents] = useState(true);
  const [spokenText, setSpokenText] = useState("");
  const [speechStatus, setSpeechStatus] = useState("");

  // État générateur de prompt & import
  const [topic, setTopic] = useState("");
  const [cardCount, setCardCount] = useState(20);
  const [targetLang, setTargetLang] = useState("vi-VN");
  const [northVietnamese, setNorthVietnamese] = useState(true);
  const [includeToneHint, setIncludeToneHint] = useState(true);
  const [promptFeedback, setPromptFeedback] = useState("");

  const [importTitle, setImportTitle] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [previewCards, setPreviewCards] = useState(null);
  const [importError, setImportError] = useState("");

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // ignore storage errors
    }
  }, [data]);

  useEffect(() => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.onvoiceschanged = () => {};
    }
  }, []);

  const currentItem = useMemo(() => {
    if (!session || !session.queue.length) return null;
    const head = session.queue[0];
    const deck = data.decks.find((d) => d.id === head.deckId);
    const card = deck?.cards.find((c) => c.id === head.cardId);
    if (!deck || !card) return null;
    return { deck, card };
  }, [session, data.decks]);

  useEffect(() => {
    if (listenMode && currentItem && tab === "study") {
      const dir = currentItem.card.bidirectional
        ? currentItem.card.progress.nextDirection || "frontToBack"
        : "frontToBack";
      const side = dir === "frontToBack" ? currentItem.card.front : currentItem.card.back;
      speakText(side.text, side.lang);
    }
  }, [listenMode, currentItem, tab]);

  function startSession(deckIds) {
    const chosenDecks = data.decks.filter((d) => deckIds.includes(d.id));
    const useSprint = chosenDecks.some((d) => d.mode === "sprint");
    const queue = [];

    chosenDecks.forEach((deck) => {
      deck.cards.forEach((card) => {
        if (onlyMinimalPairs && !card.isMinimalPair) return;
        if (isCardDue(card, deck.mode)) {
          queue.push({ deckId: deck.id, cardId: card.id });
        }
      });
    });

    setSession({
      deckIds,
      mode: useSprint ? "sprint" : "longTerm",
      queue,
    });
    setRevealed(false);
    setShowHint(false);
    setHintUsed(false);
    setSpokenText("");
    setSpeechStatus("");
    setTab("study");
  }

  function rateCard(quality) {
    if (!currentItem || !session) return;
    const { deck, card } = currentItem;
    const dir = card.bidirectional
      ? card.progress.nextDirection || "frontToBack"
      : "frontToBack";

    const nextQueue = session.queue.slice(1);
    let updatedCard = null;

    setData((prev) => ({
      ...prev,
      decks: prev.decks.map((d) => {
        if (d.id !== deck.id) return d;
        return {
          ...d,
          cards: d.cards.map((c) => {
            if (c.id !== card.id) return c;
            const p = {
              ...c.progress,
              frontToBack: { ...c.progress.frontToBack },
              backToFront: { ...c.progress.backToFront },
            };
            const sideState = p[dir];

            if (quality === "bad") {
              sideState.box = 1;
              sideState.validated = false;
              sideState.nextReview = Date.now();
            } else if (quality === "mid") {
              sideState.box = Math.min(5, sideState.box + 1);
              sideState.validated = true;
              sideState.nextReview = Date.now() + (BOX_DELAYS[sideState.box] || 1) * DAY_MS;
              if (c.bidirectional) {
                p.nextDirection = dir === "frontToBack" ? "backToFront" : "frontToBack";
              }
            } else if (quality === "easy") {
              sideState.box = Math.min(5, sideState.box + 2);
              sideState.validated = true;
              sideState.nextReview = Date.now() + (BOX_DELAYS[sideState.box] || 3) * DAY_MS;
              if (c.bidirectional) {
                p.nextDirection = dir === "frontToBack" ? "backToFront" : "frontToBack";
              }
            }

            updatedCard = { ...c, progress: p };
            return updatedCard;
          }),
        };
      }),
    }));

    if (
      session.mode === "sprint" &&
      updatedCard &&
      (quality === "bad" || !isCardMastered(updatedCard))
    ) {
      nextQueue.push({ deckId: deck.id, cardId: card.id });
    }

    setSession({ ...session, queue: nextQueue });
    setRevealed(false);
    setShowHint(false);
    setHintUsed(false);
    setSpokenText("");
    setSpeechStatus("");
  }

  function handleSpeechTest(lang) {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      setSpeechStatus("Reconnaissance vocale non supportée ici (essaie Chrome en HTTPS).");
      return;
    }
    const rec = new SpeechRec();
    rec.lang = lang;
    rec.interimResults = false;
    rec.maxAlternatives = 3;
    setSpeechStatus("Écoute en cours...");
    setSpokenText("");

    rec.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript || "";
      setSpokenText(transcript);
      setSpeechStatus("Transcription reçue");
    };
    rec.onerror = (err) => {
      setSpeechStatus("Erreur micro : " + (err.error || "vérifie les permissions / pack langue"));
    };
    rec.start();
  }

  async function handleCopyPrompt() {
    const cleanTopic = topic.trim() || "vocabulaire utile et expressions courantes";
    let extra = "";
    if (targetLang.toLowerCase().startsWith("vi") && northVietnamese) {
      extra +=
        " Utilise exclusivement le vietnamien du Nord (accent de Hanoï) pour le vocabulaire, les expressions et les explications de tons.";
    }
    if (includeToneHint) {
      extra +=
        " Remplis systématiquement 'toneHint' avec un repère clair de prononciation ou de ton.";
    }

    const prompt = `Génère exactement ${cardCount} flashcards sur : "${cleanTopic}".${extra}
Réponds UNIQUEMENT avec un tableau JSON valide (sans texte avant ni après), selon ce modèle :
[
  {
    "front": "texte côté cible (${targetLang})",
    "back": "traduction ou réponse (fr-FR)",
    "toneHint": "repère de prononciation ou de ton",
    "hint": "indice mnémotechnique court",
    "example": "exemple court d'usage",
    "isMinimalPair": false,
    "bidirectional": true
  }
]`;

    try {
      await navigator.clipboard.writeText(prompt);
      setPromptFeedback("Prompt copié dans le presse-papier.");
    } catch {
      setJsonText(prompt);
      setPromptFeedback("Copie automatique bloquée : prompt placé dans la zone texte ci-dessous.");
    }
  }

  function handlePreview() {
    setImportError("");
    setPreviewCards(null);
    const cleaned = jsonText
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    try {
      const parsed = JSON.parse(cleaned);
      const list = Array.isArray(parsed) ? parsed : parsed.cards;
      if (!Array.isArray(list) || !list.length) {
        setImportError("Aucune carte trouvée dans le JSON.");
        return;
      }
      setPreviewCards(list.map((item) => createCard(item, targetLang)));
    } catch (err) {
      setImportError("JSON invalide : " + err.message);
    }
  }

  function handleConfirmImport() {
    if (!previewCards || !previewCards.length) return;
    const title =
      importTitle.trim() || topic.trim() || `Nouveau lot (${new Date().toLocaleDateString("fr-FR")})`;

    setData((prev) => ({
      ...prev,
      decks: [
        {
          id: uid(),
          title,
          mode: "longTerm",
          selected: true,
          cards: previewCards,
        },
        ...prev.decks,
      ],
    }));

    setImportTitle("");
    setJsonText("");
    setPreviewCards(null);
    setTab("decks");
  }

  function handleExportBackup() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "memobox-ai-backup.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportBackup(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ""));
        if (Array.isArray(parsed.decks)) {
          setData(parsed);
          alert("Sauvegarde restaurée.");
        } else {
          alert("Fichier de sauvegarde invalide.");
        }
      } catch {
        alert("Impossible de lire ce fichier JSON.");
      }
    };
    reader.readAsText(file);
  }

  const activeDir = currentItem
    ? currentItem.card.bidirectional
      ? currentItem.card.progress.nextDirection || "frontToBack"
      : "frontToBack"
    : "frontToBack";
  const askSide = currentItem
    ? activeDir === "frontToBack"
      ? currentItem.card.front
      : currentItem.card.back
    : null;
  const ansSide = currentItem
    ? activeDir === "frontToBack"
      ? currentItem.card.back
      : currentItem.card.front
    : null;

  const speechMatches = useMemo(() => {
    if (!spokenText || !askSide) return null;
    return normalizeText(spokenText, strictAccents) === normalizeText(askSide.text, strictAccents);
  }, [spokenText, askSide, strictAccents]);

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <header style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.4rem" }}>MemoBox AI</h1>
          <small style={{ color: "#64748b" }}>Révision aller-retour, boîtes et import LLM</small>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => setTab("decks")}>Lots</button>
          <button onClick={() => setTab("study")}>Réviser</button>
          <button onClick={() => setTab("import")}>Prompt & Import</button>
        </div>
      </header>

      {tab === "decks" && (
        <section>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <button
                onClick={() => {
                  const ids = data.decks.filter((d) => d.selected).map((d) => d.id);
                  startSession(ids.length ? ids : data.decks.map((d) => d.id));
                }}
              >
                Réviser les lots sélectionnés
              </button>
              <label style={{ fontSize: "0.9rem" }}>
                <input
                  type="checkbox"
                  checked={onlyMinimalPairs}
                  onChange={(e) => setOnlyMinimalPairs(e.target.checked)}
                />{" "}
                Focus Tons / Paires minimales
              </label>
              <label style={{ fontSize: "0.9rem" }}>
                <input
                  type="checkbox"
                  checked={listenMode}
                  onChange={(e) => setListenMode(e.target.checked)}
                />{" "}
                Mode Écoute
              </label>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleExportBackup}>Exporter JSON</button>
              <label style={{ cursor: "pointer", border: "1px solid #cbd5e1", padding: "4px 10px", borderRadius: 6, fontSize: "0.9rem" }}>
                Importer sauvegarde
                <input type="file" accept=".json" onChange={handleImportBackup} style={{ display: "none" }} />
              </label>
            </div>
          </div>

          {data.decks.map((deck) => {
            const mastered = deck.cards.filter(isCardMastered).length;
            const due = deck.cards.filter((c) => isCardDue(c, deck.mode)).length;
            return (
              <div
                key={deck.id}
                style={{
                  border: "1px solid #cbd5e1",
                  borderRadius: 10,
                  padding: 14,
                  marginBottom: 12,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <label style={{ fontWeight: 700 }}>
                    <input
                      type="checkbox"
                      checked={Boolean(deck.selected)}
                      onChange={(e) =>
                        setData((prev) => ({
                          ...prev,
                          decks: prev.decks.map((d) =>
                            d.id === deck.id ? { ...d, selected: e.target.checked } : d
                          ),
                        }))
                      }
                    />{" "}
                    {deck.title}
                  </label>
                  <span>
                    {mastered}/{deck.cards.length} maîtrisées · {due} à revoir
                  </span>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                  <label style={{ fontSize: "0.9rem" }}>
                    Mode :{" "}
                    <select
                      value={deck.mode}
                      onChange={(e) =>
                        setData((prev) => ({
                          ...prev,
                          decks: prev.decks.map((d) =>
                            d.id === deck.id ? { ...d, mode: e.target.value } : d
                          ),
                        }))
                      }
                    >
                      <option value="longTerm">Long terme</option>
                      <option value="sprint">Sprint / Révision</option>
                    </select>
                  </label>
                  <button onClick={() => startSession([deck.id])}>Réviser ce lot</button>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {tab === "study" && (
        <section>
          {!currentItem ? (
            <div style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: 18 }}>
              <p>Aucune carte à réviser dans cette file. Lance une session depuis l'onglet Lots.</p>
              <button onClick={() => setTab("decks")}>Retour aux lots</button>
            </div>
          ) : (
            <div style={{ border: "1px solid #cbd5e1", borderRadius: 12, padding: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                <small>
                  {currentItem.deck.title} ·{" "}
                  {activeDir === "frontToBack" ? "Recto -> Verso" : "Verso -> Recto"} · Boîte{" "}
                  {currentItem.card.progress[activeDir].box}/5 · Restantes : {session.queue.length}
                </small>
                <button onClick={() => setSession(null)}>Quitter la session</button>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button onClick={() => speakText(askSide.text, askSide.lang)}>
                  Écouter ({askSide.lang})
                </button>
                <button onClick={() => handleSpeechTest(askSide.lang)}>
                  Tester prononciation ({askSide.lang})
                </button>
                <label style={{ fontSize: "0.85rem" }}>
                  <input
                    type="checkbox"
                    checked={strictAccents}
                    onChange={(e) => setStrictAccents(e.target.checked)}
                  />{" "}
                  Strict (tons/accents)
                </label>
              </div>

              <div style={{ margin: "14px 0" }}>
                {listenMode && !revealed ? (
                  <p style={{ fontStyle: "italic" }}>
                    Mode Écoute actif : clique sur « Écouter » ou retourne la carte pour voir le texte.
                  </p>
                ) : (
                  <div style={{ fontSize: "1.6rem", fontWeight: 700 }}>{askSide.text}</div>
                )}
              </div>

              {speechStatus && (
                <div style={{ background: "#f1f5f9", color: "#0f172a", padding: 10, borderRadius: 8, marginBottom: 10 }}>
                  <div><strong>{speechStatus}</strong></div>
                  {spokenText && (
                    <>
                      <div>Entendu : {spokenText}</div>
                      <div>Attendu : {askSide.text}</div>
                      <div>
                        Résultat :{" "}
                        <strong>{speechMatches ? "Correspondance OK" : "À vérifier (ton / accent)"}</strong>
                      </div>
                    </>
                  )}
                </div>
              )}

              <div style={{ marginBottom: 12 }}>
                <button
                  onClick={() => {
                    setShowHint((v) => !v);
                    setHintUsed(true);
                  }}
                >
                  {showHint ? "Masquer l'indice" : "Afficher l'indice"}
                </button>
                {showHint && (
                  <div style={{ marginTop: 8, padding: 10, background: "#f8fafc", color: "#0f172a", borderRadius: 8 }}>
                    {currentItem.card.hint && <div><strong>Indice :</strong> {currentItem.card.hint}</div>}
                    {currentItem.card.toneHint && (
                      <div><strong>Ton / Prononciation :</strong> {currentItem.card.toneHint}</div>
                    )}
                  </div>
                )}
              </div>

              {revealed && (
                <div style={{ borderTop: "1px dashed #94a3b8", paddingTop: 12, marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{ansSide.text}</div>
                    <button onClick={() => speakText(ansSide.text, ansSide.lang)}>
                      Écouter réponse
                    </button>
                  </div>
                  {currentItem.card.toneHint && (
                    <div style={{ marginTop: 6 }}><strong>Ton :</strong> {currentItem.card.toneHint}</div>
                  )}
                  {currentItem.card.example && (
                    <div style={{ marginTop: 6 }}><strong>Exemple :</strong> {currentItem.card.example}</div>
                  )}
                </div>
              )}

              {!revealed ? (
                <button onClick={() => setRevealed(true)} style={{ width: "100%", padding: 10 }}>
                  Retourner la carte
                </button>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                  <button onClick={() => rateCard("bad")}>Ne sais pas</button>
                  <button onClick={() => rateCard("mid")}>Avec indice (Moyen)</button>
                  <button disabled={hintUsed} onClick={() => rateCard("easy")}>
                    Facile
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {tab === "import" && (
        <section>
          <h2>1. Générer un prompt pour un LLM</h2>
          <label style={{ display: "block", marginBottom: 8 }}>
            Que souhaitez-vous apprendre ?
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Ex. Les salutations courantes et tons en vietnamien du Nord"
              style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
            />
          </label>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 10 }}>
            <label>
              Cartes :{" "}
              <select value={cardCount} onChange={(e) => setCardCount(Number(e.target.value))}>
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={30}>30</option>
              </select>
            </label>
            <label>
              Langue cible :{" "}
              <input
                type="text"
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                style={{ width: 90 }}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={northVietnamese}
                onChange={(e) => setNorthVietnamese(e.target.checked)}
              />{" "}
              Vietnamien du Nord (Hanoï)
            </label>
            <label>
              <input
                type="checkbox"
                checked={includeToneHint}
                onChange={(e) => setIncludeToneHint(e.target.checked)}
              />{" "}
              Repère de ton / prononciation
            </label>
          </div>

          <button onClick={handleCopyPrompt}>Copier le prompt pour LLM</button>
          {promptFeedback && <p style={{ color: "#0284c7" }}>{promptFeedback}</p>}

          <hr style={{ margin: "20px 0" }} />

          <h2>2. Importer le JSON généré</h2>
          <label style={{ display: "block", marginBottom: 8 }}>
            Nom du lot
            <input
              type="text"
              value={importTitle}
              onChange={(e) => setImportTitle(e.target.value)}
              placeholder="Ex. Vietnamien du Nord - salutations"
              style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
            />
          </label>

          <textarea
            rows={7}
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            placeholder="Colle ici la réponse JSON du LLM..."
            style={{ display: "block", width: "100%", padding: 8, fontFamily: "monospace" }}
          />

          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button onClick={handlePreview}>Prévisualiser</button>
            <button disabled={!previewCards} onClick={handleConfirmImport}>
              Importer dans mes lots
            </button>
          </div>

          {importError && <p style={{ color: "#dc2626" }}>{importError}</p>}
          {previewCards && (
            <p style={{ color: "#15803d" }}>
              {previewCards.length} carte(s) prêtes à être importées.
            </p>
          )}
        </section>
      )}
    </div>
  );
}