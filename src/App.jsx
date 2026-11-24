import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "memobox_ai_v1_1";
const DAY_MS = 86400000;

const ZONE_CONFIG = {
  0: { label: "Zone 0", days: 0, desc: "À ancrer / revient souvent" },
  1: { label: "Zone 1", days: 2, desc: "Tous les 2 jours" },
  2: { label: "Zone 2", days: 7, desc: "Toutes les semaines" },
  3: { label: "Zone 3", days: 14, desc: "Toutes les 2 semaines" },
  4: { label: "Zone 4", days: 30, desc: "Tous les mois" },
};
const MAX_ZONE = 4;

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

function createCard(raw, options = {}) {
  const isLanguage =
    raw.isLanguage !== undefined
      ? Boolean(raw.isLanguage)
      : Boolean(options.isLanguage);
  const defaultLang = isLanguage ? options.targetLang || "vi-VN" : "fr-FR";

  return {
    id: raw.id || uid(),
    isLanguage,
    front: {
      text: raw.front?.text || raw.front || "",
      lang: raw.front?.lang || raw.targetLang || defaultLang,
    },
    back: {
      text: raw.back?.text || raw.back || "",
      lang: raw.back?.lang || "fr-FR",
    },
    toneHint: isLanguage ? raw.toneHint || "" : "",
    hint: raw.hint || "",
    example: raw.example || "",
    isMinimalPair: isLanguage ? Boolean(raw.isMinimalPair) : false,
    bidirectional: raw.bidirectional !== false,
    progress: raw.progress || {
      frontToBack: { zone: 0, validated: false, nextReview: 0 },
      backToFront: { zone: 0, validated: false, nextReview: 0 },
      nextDirection: "frontToBack",
    },
  };
}

function getDefaultData() {
  return {
    decks: [
      {
        id: "deck_vi_north",
        title: "Vietnamien du Nord — Tons & bases",
        mode: "longTerm",
        selected: true,
        cards: [
          createCard(
            {
              front: "má",
              back: "maman (Nord) / joue",
              toneHint: "Thanh sắc — aigu montant (voix qui monte)",
              hint: "Membre proche de la famille ou partie du visage, avec un ton qui monte",
              example: "Má ơi, con về rồi.",
              isMinimalPair: true,
              bidirectional: true,
            },
            { isLanguage: true, targetLang: "vi-VN" }
          ),
          createCard(
            {
              front: "mà",
              back: "mais / qui / dont",
              toneHint: "Thanh huyền — grave descendant doux",
              hint: "Mot-outil de liaison ou relatif, voix douce qui descend",
              example: "Cái này rẻ mà tốt.",
              isMinimalPair: true,
              bidirectional: true,
            },
            { isLanguage: true, targetLang: "vi-VN" }
          ),
          createCard(
            {
              front: "mả",
              back: "tombe / sépulture",
              toneHint: "Thanh hỏi — plongeant puis remontant",
              hint: "Lieu de mémoire / cimetière, contour plongeant puis remontant",
              example: "Thăm mả tổ tiên.",
              isMinimalPair: true,
              bidirectional: true,
            },
            { isLanguage: true, targetLang: "vi-VN" }
          ),
        ],
      },
      {
        id: "deck_space_basics",
        title: "Espace — Mécanique céleste",
        mode: "longTerm",
        selected: false,
        cards: [
          createCard(
            {
              front: "Point de Lagrange L2",
              back: "Position d'équilibre gravitationnel derrière la Terre vue du Soleil (idéal pour les télescopes infrarouges comme JWST)",
              hint: "Zone d'équilibre à ~1,5 million de km côté nuit",
              example: "Le télescope James Webb orbite autour du point L2.",
              bidirectional: true,
            },
            { isLanguage: false }
          ),
          createCard(
            {
              front: "Vitesse de libération terrestre",
              back: "Environ 11,2 km/s (nécessaire pour quitter l'attraction terrestre sans propulsion continue)",
              hint: "Ordre de grandeur en km/s pour s'extraire de la gravité terrestre",
              example: "À 11,2 km/s, l'énergie cinétique compense le puits gravitationnel.",
              bidirectional: true,
            },
            { isLanguage: false }
          ),
        ],
      },
    ],
  };
}

function isCardMastered(card) {
  const f = card.progress.frontToBack;
  const b = card.progress.backToFront;
  if (!card.bidirectional) return f.validated && f.zone >= 1;
  return f.validated && b.validated && f.zone >= 1 && b.zone >= 1;
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
    voices.find((v) =>
      v.lang.toLowerCase().startsWith(lang.split("-")[0].toLowerCase())
    );
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

  const [editingDeckId, setEditingDeckId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [targetDeckId, setTargetDeckId] = useState("__NEW__");

  const [session, setSession] = useState(null);
  const [flipped, setFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [hintUsed, setHintUsed] = useState(false);
  const [strictAccents, setStrictAccents] = useState(true);
  const [spokenText, setSpokenText] = useState("");
  const [speechStatus, setSpeechStatus] = useState("");

  const [editingCard, setEditingCard] = useState(false);
  const [draftFront, setDraftFront] = useState("");
  const [draftBack, setDraftBack] = useState("");
  const [draftHint, setDraftHint] = useState("");
  const [draftToneHint, setDraftToneHint] = useState("");
  const [draftExample, setDraftExample] = useState("");
  const [draftF2bZone, setDraftF2bZone] = useState(0);
  const [draftB2fZone, setDraftB2fZone] = useState(0);
  const [draftNextDir, setDraftNextDir] = useState("frontToBack");

  const [topic, setTopic] = useState("");
  const [extraContext, setExtraContext] = useState("");
  const [attachPdf, setAttachPdf] = useState(false);
  const [pdfName, setPdfName] = useState("");

  const [isLanguageMode, setIsLanguageMode] = useState(true);
  const [cardCount, setCardCount] = useState(30);
  const [targetLang, setTargetLang] = useState("vi-VN");
  const [northVietnamese, setNorthVietnamese] = useState(true);
  const [includeToneHint, setIncludeToneHint] = useState(true);
  const [generatedPrompt, setGeneratedPrompt] = useState("");
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

  const askIsLanguage = Boolean(currentItem?.card.isLanguage && askSide?.lang !== "fr-FR");
  const ansIsLanguage = Boolean(currentItem?.card.isLanguage && ansSide?.lang !== "fr-FR");

  useEffect(() => {
    if (
      listenMode &&
      currentItem &&
      tab === "study" &&
      currentItem.card.isLanguage &&
      activeDir === "frontToBack" &&
      currentItem.card.front
    ) {
      speakText(currentItem.card.front.text, currentItem.card.front.lang);
    }
  }, [listenMode, currentItem, tab, activeDir]);

  function openCardEditor() {
    if (!currentItem) return;
    const { card } = currentItem;
    setDraftFront(card.front.text);
    setDraftBack(card.back.text);
    setDraftHint(card.hint || "");
    setDraftToneHint(card.toneHint || "");
    setDraftExample(card.example || "");
    setDraftF2bZone(card.progress.frontToBack?.zone ?? 0);
    setDraftB2fZone(card.progress.backToFront?.zone ?? 0);
    setDraftNextDir(card.progress.nextDirection || "frontToBack");
    setEditingCard(true);
  }

  function saveCardManualEdit(e) {
    e.preventDefault();
    if (!currentItem) return;
    const { deck, card } = currentItem;
    const zF2b = Math.max(0, Math.min(MAX_ZONE, Number(draftF2bZone) || 0));
    const zB2f = Math.max(0, Math.min(MAX_ZONE, Number(draftB2fZone) || 0));
    const now = Date.now();

    setData((prev) => ({
      ...prev,
      decks: prev.decks.map((d) => {
        if (d.id !== deck.id) return d;
        return {
          ...d,
          cards: d.cards.map((c) => {
            if (c.id !== card.id) return c;
            return {
              ...c,
              front: { ...c.front, text: draftFront.trim() || c.front.text },
              back: { ...c.back, text: draftBack.trim() || c.back.text },
              hint: draftHint.trim(),
              toneHint: c.isLanguage ? draftToneHint.trim() : "",
              example: draftExample.trim(),
              progress: {
                frontToBack: {
                  zone: zF2b,
                  validated: zF2b >= 1,
                  nextReview: now + (ZONE_CONFIG[zF2b]?.days || 0) * DAY_MS,
                },
                backToFront: {
                  zone: zB2f,
                  validated: zB2f >= 1,
                  nextReview: now + (ZONE_CONFIG[zB2f]?.days || 0) * DAY_MS,
                },
                nextDirection: c.bidirectional ? draftNextDir : "frontToBack",
              },
            };
          }),
        };
      }),
    }));

    setEditingCard(false);
  }

  function startRenameDeck(deck) {
    setEditingDeckId(deck.id);
    setEditingTitle(deck.title);
  }

  function commitRenameDeck(deckId) {
    const trimmed = editingTitle.trim();
    if (trimmed) {
      setData((prev) => ({
        ...prev,
        decks: prev.decks.map((d) => (d.id === deckId ? { ...d, title: trimmed } : d)),
      }));
    }
    setEditingDeckId(null);
    setEditingTitle("");
  }

  function deleteDeck(deckId) {
    const deck = data.decks.find((d) => d.id === deckId);
    if (!deck) return;
    const ok = window.confirm(
      `Supprimer le lot « ${deck.title} » (${deck.cards.length} carte(s)) ?`
    );
    if (!ok) return;

    setData((prev) => ({
      ...prev,
      decks: prev.decks.filter((d) => d.id !== deckId),
    }));
    if (targetDeckId === deckId) {
      setTargetDeckId("__NEW__");
    }
  }

  function prepareEnrichDeck(deck) {
    const deckHasLang = deck.cards.some((c) => c.isLanguage);
    const detectedLang =
      deck.cards.find((c) => c.front?.lang && c.front.lang !== "fr-FR")?.front.lang ||
      "vi-VN";

    setTargetDeckId(deck.id);
    setTopic(deck.title);
    setIsLanguageMode(deckHasLang);
    if (deckHasLang) {
      setTargetLang(detectedLang);
    }
    setExtraContext(
      `Enrichis le lot existant "${deck.title}" avec de nouvelles cartes utiles et progressives, sans répéter les bases déjà évidentes.`
    );
    setPromptFeedback("");
    setTab("import");
  }

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
    setFlipped(false);
    setShowHint(false);
    setHintUsed(false);
    setEditingCard(false);
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
              sideState.zone = 0;
              sideState.validated = false;
              sideState.nextReview = Date.now();
            } else if (quality === "mid") {
              const currentZone = sideState.zone ?? 0;
              sideState.zone = currentZone;
              sideState.nextReview =
                Date.now() + (ZONE_CONFIG[currentZone]?.days || 0) * DAY_MS;
            } else if (quality === "easy") {
              const nextZone = Math.min(MAX_ZONE, (sideState.zone ?? 0) + 1);
              sideState.zone = nextZone;
              sideState.validated = true;
              sideState.nextReview =
                Date.now() + (ZONE_CONFIG[nextZone]?.days || 2) * DAY_MS;
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
    setFlipped(false);
    setShowHint(false);
    setHintUsed(false);
    setEditingCard(false);
    setSpokenText("");
    setSpeechStatus("");
  }

  function handleSpeechTest(lang) {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      setSpeechStatus("Reconnaissance vocale non disponible ici (utilise Chrome en HTTPS).");
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
      setSpeechStatus("Erreur micro : " + (err.error || "vérifie les permissions"));
    };
    rec.start();
  }

  function buildPromptText() {
    const targetDeckObj =
      targetDeckId !== "__NEW__" ? data.decks.find((d) => d.id === targetDeckId) : null;
    const cleanTopic =
      topic.trim() || targetDeckObj?.title || "concepts essentiels à retenir";
    const lines = [];

    if (attachPdf) {
      lines.push(
        `IMPORTANT : J'ai joint le fichier PDF${pdfName ? ` "${pdfName}"` : ""} à cette conversation. Base tes flashcards directement sur le contenu de ce document.`
      );
    }

    lines.push(`Génère exactement ${cardCount} flashcards sur : "${cleanTopic}".`);

    if (targetDeckObj) {
      lines.push(
        `Ces cartes viendront enrichir le lot existant "${targetDeckObj.title}" (qui contient déjà ${targetDeckObj.cards.length} cartes) : propose des éléments nouveaux et complémentaires.`
      );
    }

    if (extraContext.trim()) {
      lines.push(`Contexte et précisions complémentaires : ${extraContext.trim()}`);
    }

    lines.push(
      "Règle pour 'hint' : rédige un VRAI indice (catégorie, contexte d'usage, nuance ou première lettre) qui aide à réfléchir SANS jamais dévoiler la réponse ni la traduction."
    );

    if (isLanguageMode) {
      if (targetLang.toLowerCase().startsWith("vi") && northVietnamese) {
        lines.push(
          "Mode langue activé : utilise exclusivement le vietnamien du Nord (accent de Hanoï) pour les mots/phrases et les explications."
        );
      } else {
        lines.push(`Mode langue activé : côté cible en ${targetLang}, traduction en français.`);
      }
      if (includeToneHint) {
        lines.push("Remplis 'toneHint' avec la prononciation / le repère de ton (affiché au verso).");
      }
    } else {
      lines.push(
        "Mode connaissances générales / sciences : pas besoin de ton ou prononciation audio, privilégie des explications claires, précises et synthétiques."
      );
    }

    lines.push(
      `Format de sortie OBLIGATOIRE : retourne UNIQUEMENT un unique bloc de code JSON valide (\`\`\`json ... \`\`\`), sans texte avant ni après, facilement sélectionnable et copiable, respectant ce schéma :
\`\`\`json
[
  {
    "front": "question ou terme recto",
    "back": "réponse ou définition verso",
    "toneHint": ${isLanguageMode && includeToneHint ? '"repère de ton / prononciation"' : '""'},
    "hint": "indice non spoilant",
    "example": "exemple court ou application",
    "isMinimalPair": false,
    "bidirectional": true
  }
]
\`\`\``
    );

    return lines.join("\n\n");
  }

  async function handleCopyPrompt() {
    const prompt = buildPromptText();
    setGeneratedPrompt(prompt);

    try {
      await navigator.clipboard.writeText(prompt);
      setPromptFeedback(
        attachPdf
          ? "Prompt JSON copié ! Pense bien à joindre ton PDF dans la conversation avec l'IA."
          : "Prompt JSON copié dans le presse-papier."
      );
    } catch {
      setPromptFeedback("Copie auto bloquée : utilise le bloc ci-dessous pour copier le prompt.");
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
      setPreviewCards(
        list.map((item) =>
          createCard(item, {
            isLanguage: isLanguageMode,
            targetLang,
          })
        )
      );
    } catch (err) {
      setImportError("JSON invalide : " + err.message);
    }
  }

  function handleConfirmImport() {
    if (!previewCards || !previewCards.length) return;

    if (targetDeckId !== "__NEW__") {
      const existing = data.decks.find((d) => d.id === targetDeckId);
      if (existing) {
        setData((prev) => ({
          ...prev,
          decks: prev.decks.map((d) =>
            d.id === existing.id
              ? { ...d, selected: true, cards: [...d.cards, ...previewCards] }
              : d
          ),
        }));
        setJsonText("");
        setPreviewCards(null);
        setTab("decks");
        return;
      }
    }

    const title =
      importTitle.trim() ||
      topic.trim() ||
      pdfName.replace(/\.pdf$/i, "") ||
      `Nouveau lot (${new Date().toLocaleDateString("fr-FR")})`;

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
    setTargetDeckId("__NEW__");
    setTab("decks");
  }

  function handleExportBackup() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "memobox-ai-v1.1-backup.json";
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

  const speechMatches = useMemo(() => {
    if (!spokenText || !askSide) return null;
    return normalizeText(spokenText, strictAccents) === normalizeText(askSide.text, strictAccents);
  }, [spokenText, askSide, strictAccents]);

  const currentZoneNum = currentItem ? currentItem.card.progress[activeDir]?.zone ?? 0 : 0;
  const selectedTargetDeck =
    targetDeckId !== "__NEW__" ? data.decks.find((d) => d.id === targetDeckId) : null;

  return (
    <div className="mb-page">
      <style>{`
        @import url('[https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=JetBrains+Mono:wght@400;500&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap](https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=JetBrains+Mono:wght@400;500&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap)');

        :root {
          --paper: #FAF7F2;
          --paper-card: #FFFFFF;
          --paper-warm: #F2ECE1;
          --ink: #1C1917;
          --ink-muted: #68625C;
          --line: #E4DDD0;
          --accent: #B45309;
          --accent-soft: #FEF3C7;
          --ok: #15803D;
          --ok-soft: #DCFCE7;
          --bad: #B91C1C;
          --bad-soft: #FEE2E2;
          --shadow: 0 10px 28px -12px rgba(28, 25, 23, 0.12), 0 2px 6px rgba(28, 25, 23, 0.05);
        }

        * { box-sizing: border-box; }

        .mb-page {
          min-height: 100vh;
          background:
            radial-gradient(circle at 12% 0%, rgba(180, 83, 9, 0.06), transparent 42%),
            radial-gradient(circle at 90% 10%, rgba(28, 25, 23, 0.04), transparent 38%),
            var(--paper);
          color: var(--ink);
          font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
          padding: 24px 16px 56px;
        }

        .mb-container {
          max-width: 840px;
          margin: 0 auto;
        }

        .mb-header {
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          align-items: center;
          gap: 14px;
          padding-bottom: 18px;
          border-bottom: 1px solid var(--line);
          margin-bottom: 22px;
        }

        .mb-brand h1 {
          margin: 0;
          font-family: 'Fraunces', Georgia, serif;
          font-size: 1.75rem;
          letter-spacing: -0.02em;
          color: var(--ink);
        }

        .mb-brand p {
          margin: 2px 0 0;
          font-size: 0.9rem;
          color: var(--ink-muted);
        }

        .mb-nav {
          display: flex;
          gap: 6px;
          background: var(--paper-warm);
          padding: 5px;
          border-radius: 12px;
          border: 1px solid var(--line);
        }

        .mb-nav button {
          border: none;
          background: transparent;
          color: var(--ink-muted);
          font-weight: 600;
          font-size: 0.9rem;
          padding: 8px 14px;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.16s ease;
        }

        .mb-nav button.is-active {
          background: var(--paper-card);
          color: var(--ink);
          box-shadow: 0 2px 6px rgba(28, 25, 23, 0.08);
        }

        .mb-panel {
          background: var(--paper-card);
          border: 1px solid var(--line);
          border-radius: 16px;
          padding: 20px;
          box-shadow: var(--shadow);
          margin-bottom: 16px;
        }

        .mb-btn {
          background: var(--paper-card);
          color: var(--ink);
          border: 1px solid var(--line);
          border-radius: 10px;
          padding: 9px 14px;
          font-weight: 600;
          font-size: 0.9rem;
          cursor: pointer;
          transition: transform 0.12s ease, background 0.15s ease, border-color 0.15s ease;
        }

        .mb-btn:hover:not(:disabled) {
          background: var(--paper-warm);
          border-color: #CFC5B4;
        }

        .mb-btn:active:not(:disabled) {
          transform: translateY(1px);
        }

        .mb-btn:disabled {
          opacity: 0.42;
          cursor: not-allowed;
        }

        .mb-btn-primary {
          background: var(--ink);
          color: #FAF7F2;
          border-color: var(--ink);
        }

        .mb-btn-primary:hover:not(:disabled) {
          background: #2E2925;
          border-color: #2E2925;
        }

        .mb-btn-accent {
          background: var(--accent);
          color: #FFFFFF;
          border-color: var(--accent);
        }

        .mb-btn-accent:hover:not(:disabled) {
          background: #92400E;
        }

        .mb-btn-danger {
          color: var(--bad);
          border-color: #FECACA;
          background: #FFF5F5;
        }

        .mb-btn-danger:hover:not(:disabled) {
          background: var(--bad-soft);
        }

        .mb-deck-card {
          border: 1px solid var(--line);
          background: var(--paper-card);
          border-radius: 14px;
          padding: 16px 18px;
          margin-bottom: 12px;
          box-shadow: 0 3px 10px rgba(28, 25, 23, 0.04);
        }

        .mb-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 0.78rem;
          font-weight: 600;
          padding: 4px 10px;
          border-radius: 999px;
          background: var(--paper-warm);
          color: var(--ink);
        }

        .mb-pill-lang {
          background: var(--accent-soft);
          color: #92400E;
        }

        .mb-zones-legend {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(135px, 1fr));
          gap: 8px;
          margin-top: 14px;
        }

        .mb-zone-chip {
          background: var(--paper);
          border: 1px solid var(--line);
          border-radius: 10px;
          padding: 8px 10px;
          font-size: 0.78rem;
        }

        .mb-zone-chip strong {
          display: block;
          font-size: 0.84rem;
        }

        /* Retournement 3D sans débordement du verso */
        .mb-flip-scene {
          perspective: 1200px;
          margin: 14px 0 18px;
        }

        .mb-flip-card {
          display: grid;
          transform-style: preserve-3d;
          transition: transform 0.55s cubic-bezier(0.22, 1, 0.36, 1);
        }

        .mb-flip-card.is-flipped {
          transform: rotateY(180deg);
        }

        .mb-face {
          grid-area: 1 / 1;
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
          background: linear-gradient(180deg, #FFFFFF 0%, #FDFBF7 100%);
          border: 1px solid var(--line);
          border-radius: 16px;
          padding: 22px;
          box-shadow: var(--shadow);
          min-height: 260px;
          max-height: 72vh;
          overflow-y: auto;
          overflow-wrap: anywhere;
          word-break: break-word;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }

        .mb-face-back {
          transform: rotateY(180deg);
          background: linear-gradient(180deg, #FFFDF9 0%, #F7F2E8 100%);
        }

        .mb-word {
          font-family: 'Fraunces', Georgia, serif;
          font-size: 1.75rem;
          line-height: 1.28;
          margin: 12px 0;
          color: var(--ink);
          overflow-wrap: anywhere;
        }

        .mb-answer-word {
          font-size: 1.25rem;
          line-height: 1.4;
          font-weight: 700;
          color: var(--ink);
          overflow-wrap: anywhere;
        }

        .mb-note-box {
          background: var(--paper);
          border-left: 3px solid var(--accent);
          border-radius: 8px;
          padding: 10px 12px;
          font-size: 0.9rem;
          margin-top: 10px;
          overflow-wrap: anywhere;
        }

        .mb-code-block {
          margin-top: 12px;
          background: #1C1917;
          color: #FAF7F2;
          border-radius: 12px;
          padding: 14px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.8rem;
          line-height: 1.5;
          white-space: pre-wrap;
          overflow-x: auto;
          overflow-wrap: anywhere;
        }

        .mb-rate-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
        }

        .mb-rate-bad {
          background: var(--bad-soft);
          border-color: #FCA5A5;
          color: var(--bad);
        }

        .mb-rate-mid {
          background: var(--accent-soft);
          border-color: #FCD34D;
          color: #92400E;
        }

        .mb-rate-easy {
          background: var(--ok-soft);
          border-color: #86EFAC;
          color: var(--ok);
        }

        input[type="text"],
        select,
        textarea {
          width: 100%;
          border: 1px solid var(--line);
          background: var(--paper);
          color: var(--ink);
          border-radius: 10px;
          padding: 10px 12px;
          font-family: inherit;
          font-size: 0.95rem;
        }

        textarea {
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.85rem;
        }

        .mb-field-label {
          display: block;
          font-weight: 600;
          font-size: 0.88rem;
          margin: 12px 0 6px;
        }

        @media (max-width: 600px) {
          .mb-rate-grid {
            grid-template-columns: 1fr;
          }
          .mb-word {
            font-size: 1.45rem;
          }
        }
      `}</style>

      <div className="mb-container">
        <header className="mb-header">
          <div className="mb-brand">
            <h1>MemoBox AI</h1>
            <p>Zones de mémoire, cartes recto-verso et enrichissement progressif</p>
          </div>

          <nav className="mb-nav" aria-label="Navigation principale">
            <button
              className={tab === "decks" ? "is-active" : ""}
              onClick={() => setTab("decks")}
            >
              Lots
            </button>
            <button
              className={tab === "study" ? "is-active" : ""}
              onClick={() => setTab("study")}
            >
              Réviser
            </button>
            <button
              className={tab === "import" ? "is-active" : ""}
              onClick={() => setTab("import")}
            >
              Prompt & Import
            </button>
          </nav>
        </header>

        {tab === "decks" && (
          <section>
            <div className="mb-panel">
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <button
                    className="mb-btn mb-btn-primary"
                    onClick={() => {
                      const ids = data.decks.filter((d) => d.selected).map((d) => d.id);
                      startSession(ids.length ? ids : data.decks.map((d) => d.id));
                    }}
                  >
                    Réviser la sélection
                  </button>

                  <label style={{ fontSize: "0.88rem", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={onlyMinimalPairs}
                      onChange={(e) => setOnlyMinimalPairs(e.target.checked)}
                    />{" "}
                    Tons / Paires minimales
                  </label>

                  <label style={{ fontSize: "0.88rem", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={listenMode}
                      onChange={(e) => setListenMode(e.target.checked)}
                    />{" "}
                    Mode écoute (A → B)
                  </label>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="mb-btn" onClick={handleExportBackup}>
                    Exporter JSON
                  </button>
                  <label className="mb-btn" style={{ cursor: "pointer" }}>
                    Importer sauvegarde
                    <input
                      type="file"
                      accept=".json"
                      onChange={handleImportBackup}
                      style={{ display: "none" }}
                    />
                  </label>
                </div>
              </div>

              <div className="mb-zones-legend">
                {Object.entries(ZONE_CONFIG).map(([zKey, zInfo]) => (
                  <div key={zKey} className="mb-zone-chip">
                    <strong>{zInfo.label}</strong>
                    <span style={{ color: "var(--ink-muted)" }}>{zInfo.desc}</span>
                  </div>
                ))}
              </div>
            </div>

            {data.decks.map((deck) => {
              const mastered = deck.cards.filter(isCardMastered).length;
              const due = deck.cards.filter((c) => isCardDue(c, deck.mode)).length;
              const langCount = deck.cards.filter((c) => c.isLanguage).length;
              const isRenaming = editingDeckId === deck.id;

              return (
                <div key={deck.id} className="mb-deck-card">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: 10,
                      alignItems: "center",
                    }}
                  >
                    {isRenaming ? (
                      <div style={{ display: "flex", gap: 8, flex: "1 1 280px", alignItems: "center" }}>
                        <input
                          type="text"
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRenameDeck(deck.id);
                            if (e.key === "Escape") setEditingDeckId(null);
                          }}
                          style={{ padding: "7px 10px" }}
                        />
                        <button
                          className="mb-btn mb-btn-primary"
                          onClick={() => commitRenameDeck(deck.id)}
                        >
                          Valider
                        </button>
                        <button className="mb-btn" onClick={() => setEditingDeckId(null)}>
                          Annuler
                        </button>
                      </div>
                    ) : (
                      <label style={{ fontWeight: 700, fontSize: "1.02rem", cursor: "pointer" }}>
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
                    )}

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      {langCount > 0 && (
                        <span className="mb-pill mb-pill-lang">Langue ({langCount})</span>
                      )}
                      <span className="mb-pill">
                        {mastered}/{deck.cards.length} maîtrisées · {due} à revoir
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: 10,
                      marginTop: 12,
                      alignItems: "center",
                    }}
                  >
                    <label style={{ fontSize: "0.88rem" }}>
                      Rythme :{" "}
                      <select
                        style={{ width: "auto", padding: "6px 10px" }}
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
                        <option value="longTerm">Zones (long terme)</option>
                        <option value="sprint">Sprint (rattrapage)</option>
                      </select>
                    </label>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button className="mb-btn" onClick={() => prepareEnrichDeck(deck)}>
                        + Étoffer
                      </button>
                      <button className="mb-btn" onClick={() => startRenameDeck(deck)}>
                        Renommer
                      </button>
                      <button className="mb-btn mb-btn-danger" onClick={() => deleteDeck(deck.id)}>
                        Supprimer
                      </button>
                      <button className="mb-btn mb-btn-primary" onClick={() => startSession([deck.id])}>
                        Réviser ce lot
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {tab === "study" && (
          <section>
            {!currentItem ? (
              <div className="mb-panel">
                <h2 style={{ fontFamily: "'Fraunces', serif", marginTop: 0 }}>
                  Session terminée ou non démarrée
                </h2>
                <p style={{ color: "var(--ink-muted)" }}>
                  Aucune carte en attente dans cette file. Choisis un lot pour lancer une session.
                </p>
                <button className="mb-btn mb-btn-primary" onClick={() => setTab("decks")}>
                  Retour aux lots
                </button>
              </div>
            ) : (
              <div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <span className="mb-pill">Zone {currentZoneNum}</span>
                    <span className="mb-pill">
                      {activeDir === "frontToBack" ? "A → B (Recto → Verso)" : "B → A (Verso → Recto)"}
                    </span>
                    <span className="mb-pill">Restantes : {session.queue.length}</span>
                  </div>

                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      className="mb-btn"
                      onClick={() => (editingCard ? setEditingCard(false) : openCardEditor())}
                    >
                      {editingCard ? "Fermer l'édition" : "Modifier la carte"}
                    </button>
                    <button className="mb-btn" onClick={() => setSession(null)}>
                      Quitter
                    </button>
                  </div>
                </div>

                {editingCard && (
                  <form className="mb-panel" style={{ marginTop: 12 }} onSubmit={saveCardManualEdit}>
                    <h3 style={{ fontFamily: "'Fraunces', serif", marginTop: 0 }}>
                      Mise à jour manuelle de la carte
                    </h3>

                    <label className="mb-field-label">
                      Recto (A)
                      <input
                        type="text"
                        value={draftFront}
                        onChange={(e) => setDraftFront(e.target.value)}
                      />
                    </label>

                    <label className="mb-field-label">
                      Verso (B)
                      <input
                        type="text"
                        value={draftBack}
                        onChange={(e) => setDraftBack(e.target.value)}
                      />
                    </label>

                    <label className="mb-field-label">
                      Indice (sans révéler la réponse)
                      <input
                        type="text"
                        value={draftHint}
                        onChange={(e) => setDraftHint(e.target.value)}
                      />
                    </label>

                    {currentItem.card.isLanguage && (
                      <label className="mb-field-label">
                        Repère de ton / prononciation
                        <input
                          type="text"
                          value={draftToneHint}
                          onChange={(e) => setDraftToneHint(e.target.value)}
                        />
                      </label>
                    )}

                    <label className="mb-field-label">
                      Exemple
                      <input
                        type="text"
                        value={draftExample}
                        onChange={(e) => setDraftExample(e.target.value)}
                      />
                    </label>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                        gap: 10,
                        marginTop: 12,
                      }}
                    >
                      <label className="mb-field-label" style={{ margin: 0 }}>
                        Zone A → B
                        <select
                          value={draftF2bZone}
                          onChange={(e) => setDraftF2bZone(Number(e.target.value))}
                        >
                          {[0, 1, 2, 3, 4].map((z) => (
                            <option key={z} value={z}>
                              Zone {z}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="mb-field-label" style={{ margin: 0 }}>
                        Zone B → A
                        <select
                          value={draftB2fZone}
                          onChange={(e) => setDraftB2fZone(Number(e.target.value))}
                        >
                          {[0, 1, 2, 3, 4].map((z) => (
                            <option key={z} value={z}>
                              Zone {z}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="mb-field-label" style={{ margin: 0 }}>
                        Prochain sens
                        <select
                          value={draftNextDir}
                          onChange={(e) => setDraftNextDir(e.target.value)}
                        >
                          <option value="frontToBack">A → B</option>
                          <option value="backToFront">B → A</option>
                        </select>
                      </label>
                    </div>

                    <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                      <button type="submit" className="mb-btn mb-btn-primary">
                        Enregistrer les modifications
                      </button>
                      <button
                        type="button"
                        className="mb-btn"
                        onClick={() => setEditingCard(false)}
                      >
                        Annuler
                      </button>
                    </div>
                  </form>
                )}

                <div className="mb-flip-scene">
                  <div className={`mb-flip-card ${flipped ? "is-flipped" : ""}`}>
                    {/* RECTO */}
                    <div className="mb-face">
                      <div>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            flexWrap: "wrap",
                            gap: 8,
                            alignItems: "center",
                          }}
                        >
                          <small style={{ color: "var(--ink-muted)", fontWeight: 600 }}>
                            {currentItem.deck.title}
                          </small>

                          {askIsLanguage && (
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                              <button
                                className="mb-btn"
                                onClick={() => speakText(askSide.text, askSide.lang)}
                              >
                                Écouter ({askSide.lang})
                              </button>
                              <button
                                className="mb-btn"
                                onClick={() => handleSpeechTest(askSide.lang)}
                              >
                                Tester voix
                              </button>
                              <label style={{ fontSize: "0.82rem", cursor: "pointer" }}>
                                <input
                                  type="checkbox"
                                  checked={strictAccents}
                                  onChange={(e) => setStrictAccents(e.target.checked)}
                                />{" "}
                                Strict
                              </label>
                            </div>
                          )}
                        </div>

                        <div className="mb-word">
                          {listenMode &&
                          askIsLanguage &&
                          activeDir === "frontToBack" &&
                          !flipped ? (
                            <span style={{ fontSize: "1.2rem", fontStyle: "italic", color: "var(--ink-muted)" }}>
                              Mode écoute actif (A → B) — clique sur « Écouter » ou retourne la carte.
                            </span>
                          ) : (
                            askSide.text
                          )}
                        </div>

                        {speechStatus && askIsLanguage && (
                          <div className="mb-note-box">
                            <strong>{speechStatus}</strong>
                            {spokenText && (
                              <div style={{ marginTop: 4 }}>
                                Entendu : <code>{spokenText}</code> · Attendu :{" "}
                                <code>{askSide.text}</code> ·{" "}
                                <strong>
                                  {speechMatches ? "Correspondance OK" : "À vérifier"}
                                </strong>
                              </div>
                            )}
                          </div>
                        )}

                        {showHint && (
                          <div className="mb-note-box">
                            <div>
                              <strong>Indice :</strong>{" "}
                              {currentItem.card.hint ||
                                "Aucun indice enregistré pour cette carte."}
                            </div>
                          </div>
                        )}
                      </div>

                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          flexWrap: "wrap",
                          gap: 10,
                          marginTop: 14,
                        }}
                      >
                        <button
                          className="mb-btn"
                          onClick={() => {
                            setShowHint((v) => !v);
                            setHintUsed(true);
                          }}
                        >
                          {showHint ? "Masquer l'indice" : "Afficher l'indice"}
                        </button>

                        <button
                          className="mb-btn mb-btn-primary"
                          onClick={() => setFlipped(true)}
                        >
                          Retourner la carte
                        </button>
                      </div>
                    </div>

                    {/* VERSO */}
                    <div className="mb-face mb-face-back">
                      <div>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            flexWrap: "wrap",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <small style={{ color: "var(--ink-muted)", fontWeight: 600 }}>
                            Réponse · Zone {currentZoneNum} →{" "}
                            {hintUsed
                              ? `Zone ${currentZoneNum} (avec indice)`
                              : `Zone ${Math.min(MAX_ZONE, currentZoneNum + 1)} si Facile`}
                          </small>

                          {ansIsLanguage && (
                            <button
                              className="mb-btn"
                              onClick={() => speakText(ansSide.text, ansSide.lang)}
                            >
                              Écouter réponse
                            </button>
                          )}
                        </div>

                        <div className="mb-answer-word" style={{ marginTop: 12 }}>
                          {ansSide.text}
                        </div>

                        {currentItem.card.toneHint && (
                          <div className="mb-note-box">
                            <strong>Ton / Prononciation :</strong> {currentItem.card.toneHint}
                          </div>
                        )}

                        {currentItem.card.example && (
                          <p style={{ margin: "10px 0 0", color: "var(--ink-muted)", fontSize: "0.92rem" }}>
                            <strong>Exemple :</strong> {currentItem.card.example}
                          </p>
                        )}
                      </div>

                      <div style={{ marginTop: 16 }}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            flexWrap: "wrap",
                            alignItems: "center",
                            gap: 8,
                            marginBottom: 8,
                          }}
                        >
                          <small style={{ color: "var(--ink-muted)" }}>
                            {hintUsed
                              ? "Indice consulté : « Facile » est désactivé pour ce tour."
                              : "Évalue ton rappel pour mettre à jour la zone :"}
                          </small>
                          <button className="mb-btn" onClick={() => setFlipped(false)}>
                            Voir le recto
                          </button>
                        </div>

                        <div className="mb-rate-grid">
                          <button
                            className="mb-btn mb-rate-bad"
                            onClick={() => rateCard("bad")}
                          >
                            Ne sais pas (→ Zone 0)
                          </button>
                          <button
                            className="mb-btn mb-rate-mid"
                            onClick={() => rateCard("mid")}
                          >
                            Avec indice (Reste Zone {currentZoneNum})
                          </button>
                          <button
                            className="mb-btn mb-rate-easy"
                            disabled={hintUsed}
                            onClick={() => rateCard("easy")}
                          >
                            Facile (→ Zone {Math.min(MAX_ZONE, currentZoneNum + 1)})
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {tab === "import" && (
          <section className="mb-panel">
            <h2 style={{ fontFamily: "'Fraunces', serif", marginTop: 0 }}>
              1. Générer le prompt JSON pour l'IA
            </h2>

            <label className="mb-field-label">
              Sujet / Ce que tu veux apprendre ou approfondir
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Ex. Vietnamien du Nord — leçon 4 : famille et repas"
              />
            </label>

            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 12,
                background: "var(--paper)",
                border: "1px solid var(--line)",
              }}
            >
              <label style={{ fontWeight: 600, fontSize: "0.9rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={attachPdf}
                  onChange={(e) => setAttachPdf(e.target.checked)}
                />{" "}
                Joindre un PDF à la conversation avec l'IA (ajoute un rappel dans le prompt)
              </label>

              {attachPdf && (
                <div style={{ marginTop: 10 }}>
                  <label className="mb-btn" style={{ cursor: "pointer" }}>
                    {pdfName ? `PDF sélectionné : ${pdfName}` : "Choisir le fichier PDF de référence"}
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      style={{ display: "none" }}
                      onChange={(e) => setPdfName(e.target.files?.[0]?.name || "")}
                    />
                  </label>
                </div>
              )}

              <label className="mb-field-label" style={{ marginTop: 10 }}>
                Contexte ou précisions supplémentaires (optionnel)
                <input
                  type="text"
                  value={extraContext}
                  onChange={(e) => setExtraContext(e.target.value)}
                  placeholder="Ex. Ajoute des phrases courantes à l'oral à Hanoï, paires minimales..."
                />
              </label>
            </div>

            <div
              style={{
                marginTop: 14,
                padding: 12,
                borderRadius: 12,
                background: "var(--paper)",
                border: "1px solid var(--line)",
              }}
            >
              <label style={{ fontWeight: 700, fontSize: "0.92rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={isLanguageMode}
                  onChange={(e) => setIsLanguageMode(e.target.checked)}
                />{" "}
                Mode apprentissage de langue (active voix, micro et repères de tons sur les cartes)
              </label>

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 12,
                  alignItems: "center",
                  marginTop: 10,
                }}
              >
                <label style={{ fontSize: "0.88rem" }}>
                  Nombre de cartes :{" "}
                  <select
                    style={{ width: "auto", padding: "6px 10px" }}
                    value={cardCount}
                    onChange={(e) => setCardCount(Number(e.target.value))}
                  >
                    <option value={10}>10</option>
                    <option value={15}>15</option>
                    <option value={20}>20</option>
                    <option value={30}>30</option>
                    <option value={50}>50</option>
                    <option value={80}>80</option>
                  </select>
                </label>

                {isLanguageMode && (
                  <>
                    <label style={{ fontSize: "0.88rem" }}>
                      Code langue :{" "}
                      <input
                        type="text"
                        value={targetLang}
                        onChange={(e) => setTargetLang(e.target.value)}
                        style={{ width: 92, padding: "6px 8px" }}
                      />
                    </label>

                    <label style={{ fontSize: "0.88rem", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={northVietnamese}
                        onChange={(e) => setNorthVietnamese(e.target.checked)}
                      />{" "}
                      Vietnamien du Nord
                    </label>

                    <label style={{ fontSize: "0.88rem", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={includeToneHint}
                        onChange={(e) => setIncludeToneHint(e.target.checked)}
                      />{" "}
                      Repères de ton
                    </label>
                  </>
                )}
              </div>
            </div>

            <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="mb-btn mb-btn-accent" onClick={handleCopyPrompt}>
                Générer et copier le prompt JSON
              </button>
              {generatedPrompt && (
                <button
                  className="mb-btn"
                  onClick={() => setGeneratedPrompt("")}
                >
                  Masquer le prompt
                </button>
              )}
            </div>

            {promptFeedback && (
              <p style={{ color: "var(--accent)", fontWeight: 600, marginTop: 8 }}>
                {promptFeedback}
              </p>
            )}

            {generatedPrompt && (
              <pre className="mb-code-block" aria-label="Prompt JSON généré">
                <code>{generatedPrompt}</code>
              </pre>
            )}

            <hr style={{ border: "none", borderTop: "1px solid var(--line)", margin: "22px 0" }} />

            <h2 style={{ fontFamily: "'Fraunces', serif", marginTop: 0 }}>
              2. Importer les flashcards (JSON)
            </h2>

            <label className="mb-field-label">
              Destination de l'import
              <select
                value={targetDeckId}
                onChange={(e) => setTargetDeckId(e.target.value)}
              >
                <option value="__NEW__">Créer un nouveau lot</option>
                {data.decks.map((d) => (
                  <option key={d.id} value={d.id}>
                    Étoffer le lot existant : {d.title} ({d.cards.length} cartes)
                  </option>
                ))}
              </select>
            </label>

            {!selectedTargetDeck && (
              <label className="mb-field-label">
                Titre du nouveau lot
                <input
                  type="text"
                  value={importTitle}
                  onChange={(e) => setImportTitle(e.target.value)}
                  placeholder="Ex. Vietnamien du Nord — Cours complet"
                />
              </label>
            )}

            <label className="mb-field-label">
              JSON retourné par l'IA
              <textarea
                rows={7}
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                placeholder="Colle ici le bloc ```json ... ``` ou le tableau JSON généré par l'IA..."
              />
            </label>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
              <button className="mb-btn" onClick={handlePreview}>
                Prévisualiser
              </button>
              <button
                className="mb-btn mb-btn-primary"
                disabled={!previewCards}
                onClick={handleConfirmImport}
              >
                {selectedTargetDeck
                  ? `Ajouter au lot « ${selectedTargetDeck.title} »` : "Créer le lot"} </button> </div>  {importError && ( <p style={{ color: "var(--bad)", fontWeight: 600, marginTop: 10 }}> {importError} </p> )}  {previewCards && ( <div className="mb-note-box" style={{ borderLeftColor: "var(--ok)" }}> <strong>{previewCards.length} carte(s) prête(s)</strong> · Destination :{" "} <strong> {selectedTargetDeck ? `Lot « ${selectedTargetDeck.title} »`
                    : "Nouveau lot"}
                </strong>{" "}
                · Exemple : <em>{previewCards[0].front.text}</em> →{" "}
                <em>{previewCards[0].back.text}</em>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}