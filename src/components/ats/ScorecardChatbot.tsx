import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Bot, Send, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { useCandidateContext, buildContextPrompt, CandidateFullContext } from '@/hooks/useCandidateContext';

interface Criterion {
  id: string;
  label: string;
  description: string;
  category: string;
  weight: number;
  suggestedQuestions?: string[];
}

interface ScorecardChatbotProps {
  criteria: Criterion[];
  jobTitle: string;
  jobId: string;
  candidateId: string;
  candidateName: string;
  onComplete: (result: {
    ratings: Record<string, number>;
    comments: Record<string, string>;
    overallScore: number;
    recommendation: string;
    summary: string;
  }) => void;
}

interface Message {
  id: string;
  role: 'assistant' | 'user';
  content: string;
}

export const ScorecardChatbot: React.FC<ScorecardChatbotProps> = ({
  criteria, jobTitle, jobId, candidateId, candidateName, onComplete,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [currentCriterionIdx, setCurrentCriterionIdx] = useState(-1);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [isThinking, setIsThinking] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const conversationRef = useRef<Message[]>([]);

  // Load full candidate context (LinkedIn, notes, transcripts, evaluations, RAG)
  const { data: candidateContext, isLoading: loadingContext } = useCandidateContext(candidateId, jobId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const addMessage = useCallback((role: 'assistant' | 'user', content: string) => {
    const msg = { id: `${role}-${Date.now()}-${Math.random()}`, role, content };
    setMessages(prev => [...prev, msg]);
    conversationRef.current = [...conversationRef.current, msg];
  }, []);

  // Start conversation when context is loaded
  useEffect(() => {
    if (!candidateContext || messages.length > 0) return;
    startConversation(candidateContext);
  }, [candidateContext]); // eslint-disable-line react-hooks/exhaustive-deps

  const startConversation = async (ctx: CandidateFullContext) => {
    setIsThinking(true);
    try {
      const contextPrompt = buildContextPrompt(ctx);
      const systemMsg = buildSystemPrompt(criteria, contextPrompt);

      const { data } = await invokeWithCredits<{ response?: string }>('ai-chat-completion', 'scorecard_chat', {
        messages: [
          { role: 'system', content: systemMsg },
          { role: 'user', content: `Commence l'évaluation de ${candidateName} pour le poste ${jobTitle}. Commence par le premier critère : "${criteria[0]?.label}".` },
        ],
      }, { skipCreditCheck: true });

      const response = (data as any)?.response || (data as any)?.content || buildFallbackWelcome(ctx, criteria[0]);
      addMessage('assistant', response);
      setCurrentCriterionIdx(0);
    } catch {
      addMessage('assistant', buildFallbackWelcome(candidateContext!, criteria[0]));
      setCurrentCriterionIdx(0);
    } finally {
      setIsThinking(false);
    }
  };

  const handleSend = async (text?: string) => {
    const userMsg = (text || input).trim();
    if (!userMsg || isThinking || isDone) return;
    setInput('');
    addMessage('user', userMsg);

    // Extract rating if present
    const ratingMatch = userMsg.match(/^([1-5])/);
    if (ratingMatch && currentCriterionIdx >= 0 && currentCriterionIdx < criteria.length) {
      const rating = parseInt(ratingMatch[1]);
      const comment = userMsg.replace(/^[1-5]\s*[-–—:.]?\s*/, '').trim();
      const criterion = criteria[currentCriterionIdx];
      setRatings(prev => ({ ...prev, [criterion.id]: rating }));
      if (comment) setComments(prev => ({ ...prev, [criterion.id]: comment }));
    }

    // Ask AI for contextual follow-up
    setIsThinking(true);
    try {
      const ctx = candidateContext;
      const contextPrompt = ctx ? buildContextPrompt(ctx) : '';
      const nextIdx = ratingMatch ? currentCriterionIdx + 1 : currentCriterionIdx;
      const isLastCriterion = nextIdx >= criteria.length;

      const allMessages = [
        { role: 'system', content: buildSystemPrompt(criteria, contextPrompt) },
        ...conversationRef.current.map(m => ({ role: m.role, content: m.content })),
      ];

      if (isLastCriterion) {
        // Generate final summary
        allMessages.push({
          role: 'user',
          content: `Tous les critères ont été évalués. Génère un résumé complet de l'évaluation avec les points forts, points faibles, et ta recommandation finale. Ratings: ${JSON.stringify(ratings)}`,
        });
      } else if (ratingMatch) {
        const nextCriterion = criteria[nextIdx];
        allMessages.push({
          role: 'user',
          content: `Le recruteur a noté ${ratingMatch[1]}/5 pour "${criteria[currentCriterionIdx]?.label}". Passe au critère suivant : "${nextCriterion?.label}" (${nextCriterion?.description}). Pose une question contextuelle basée sur le profil du candidat.`,
        });
      }

      const { data } = await invokeWithCredits<{ response?: string }>('ai-chat-completion', 'scorecard_chat', {
        messages: allMessages,
      }, { skipCreditCheck: true });

      const response = (data as any)?.response || (data as any)?.content;

      if (response) {
        addMessage('assistant', response);
      } else if (isLastCriterion) {
        // Fallback summary
        finalizeChatbot();
      } else if (ratingMatch) {
        // Fallback: simple next criterion prompt
        const next = criteria[nextIdx];
        addMessage('assistant', buildFallbackCriterionPrompt(candidateContext!, next, nextIdx, criteria.length));
      }

      if (ratingMatch) {
        setCurrentCriterionIdx(nextIdx);
        if (isLastCriterion) {
          finalizeChatbot();
        }
      }
    } catch {
      // Fallback without AI
      if (ratingMatch) {
        const nextIdx = currentCriterionIdx + 1;
        if (nextIdx < criteria.length) {
          addMessage('assistant', buildFallbackCriterionPrompt(candidateContext!, criteria[nextIdx], nextIdx, criteria.length));
          setCurrentCriterionIdx(nextIdx);
        } else {
          finalizeChatbot();
        }
      } else {
        addMessage('assistant', "Je n'ai pas compris. Donnez une note de **1 à 5** pour ce critère.");
      }
    } finally {
      setIsThinking(false);
    }
  };

  const finalizeChatbot = () => {
    let totalWeighted = 0;
    let totalWeight = 0;
    for (const c of criteria) {
      const r = ratings[c.id];
      if (r) { totalWeighted += r * c.weight; totalWeight += c.weight; }
    }
    const overallScore = totalWeight > 0 ? Math.round((totalWeighted / totalWeight) * 10) / 10 : 0;
    let recommendation = 'maybe';
    if (overallScore >= 4.2) recommendation = 'strong_yes';
    else if (overallScore >= 3.5) recommendation = 'yes';
    else if (overallScore >= 2.5) recommendation = 'maybe';
    else if (overallScore >= 1.5) recommendation = 'no';
    else recommendation = 'strong_no';

    const strengths = criteria.filter(c => (ratings[c.id] || 0) >= 4).map(c => c.label);
    const weaknesses = criteria.filter(c => (ratings[c.id] || 0) <= 2).map(c => c.label);

    setIsDone(true);
    onComplete({
      ratings, comments, overallScore, recommendation,
      summary: `Score: ${overallScore}/5. Forces: ${strengths.join(', ') || 'N/A'}. Faiblesses: ${weaknesses.join(', ') || 'N/A'}.`,
    });
  };

  const progress = criteria.length > 0 ? Math.round((Object.keys(ratings).length / criteria.length) * 100) : 0;

  return (
    <div className="border border-foreground/20 flex flex-col h-[550px]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-foreground/20 flex items-center justify-between bg-foreground/5">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-foreground" />
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-foreground">Évaluation guidée IA</p>
            <p className="text-[9px] text-muted-foreground">{candidateName} · {jobTitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-20 h-1.5 bg-foreground/10">
              <div className="h-full bg-foreground transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-[9px] font-bold text-muted-foreground">{Object.keys(ratings).length}/{criteria.length}</span>
          </div>
          {isDone && <CheckCircle2 className="w-4 h-4 text-foreground" />}
        </div>
      </div>

      {/* Context loading indicator */}
      {loadingContext && (
        <div className="px-4 py-2 border-b border-foreground/10 bg-muted/20 flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
          <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Chargement du contexte candidat (LinkedIn, notes, appels, évaluations)...</span>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map(msg => (
          <div key={msg.id} className={cn("flex", msg.role === 'user' ? "justify-end" : "justify-start")}>
            <div className={cn(
              "max-w-[85%] px-3 py-2 text-sm leading-relaxed",
              msg.role === 'user'
                ? "bg-foreground text-background"
                : "bg-muted/30 border border-foreground/10 text-foreground"
            )}>
              {msg.content.split('\n').map((line, i) => (
                <p key={i} className={i > 0 ? "mt-1.5" : ""}>
                  {line.split(/\*\*(.*?)\*\*/g).map((part, j) =>
                    j % 2 === 1 ? <strong key={j}>{part}</strong> : part
                  )}
                </p>
              ))}
            </div>
          </div>
        ))}
        {isThinking && (
          <div className="flex justify-start">
            <div className="px-3 py-2 bg-muted/30 border border-foreground/10 flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-foreground/20 border-t-foreground animate-spin" />
              <span className="text-[10px] text-muted-foreground">Réflexion en cours...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      {!isDone && (
        <div className="px-4 py-3 border-t border-foreground/20">
          <div className="flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSend(); } }}
              placeholder={currentCriterionIdx >= 0 ? 'Note (1-5) + commentaire...' : 'Votre réponse...'}
              disabled={isThinking || loadingContext}
              className="flex-1 h-[36px] px-3 text-sm border border-foreground/20 bg-background text-foreground focus:border-foreground focus:outline-none transition-colors disabled:opacity-50"
            />
            {currentCriterionIdx >= 0 && currentCriterionIdx < criteria.length && (
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    onClick={() => handleSend(String(n))}
                    disabled={isThinking}
                    className="w-[36px] h-[36px] text-sm font-bold border border-foreground/20 text-foreground hover:bg-foreground hover:text-background transition-colors disabled:opacity-30"
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || isThinking}
              className="h-[36px] w-[36px] flex items-center justify-center bg-foreground text-background border border-foreground disabled:opacity-30"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Prompt builders ────────────────────────────────────────

function buildSystemPrompt(criteria: Criterion[], contextPrompt: string): string {
  return `Tu es un assistant IA expert en recrutement qui aide à évaluer un candidat de manière structurée et contextuelle.

${contextPrompt}

## Critères d'évaluation (${criteria.length})
${criteria.map((c, i) => `${i + 1}. **${c.label}** (${c.category}, poids: ${c.weight}/3) — ${c.description}`).join('\n')}

## Instructions
- Pour chaque critère, pose une question contextuelle basée sur le profil du candidat, son expérience, et les notes/appels précédents.
- Utilise les informations du profil LinkedIn, les notes des recruteurs, et les transcripts d'appels pour poser des questions pertinentes.
- Si le candidat a des skills manquants identifiés par l'IA, explore ces points.
- Si des red flags ou points forts ont été identifiés dans des évaluations précédentes, creuse ces sujets.
- Quand le recruteur donne une note, confirme et donne une insight contextuelle basée sur les données disponibles.
- Sois concis mais utile. Pas de réponses génériques.
- Réponds en français.`;
}

function buildFallbackWelcome(ctx: CandidateFullContext, firstCriterion: Criterion): string {
  const parts = [`Bonjour ! Je vais vous aider à évaluer **${ctx.name}** pour le poste **${ctx.jobTitle || 'non défini'}**.`];

  if (ctx.score != null) {
    parts.push(`\nLe scoring IA donne **${ctx.score}/100** avec une recommandation **${ctx.recommendation || 'N/A'}**.`);
  }
  if (ctx.scoringDetails?.matching_skills?.length) {
    parts.push(`Skills correspondants : ${ctx.scoringDetails.matching_skills.slice(0, 5).join(', ')}.`);
  }
  if (ctx.callTranscripts.length > 0) {
    parts.push(`\n📞 ${ctx.callTranscripts.length} appel(s) précédent(s) enregistré(s) — j'ai le contexte.`);
  }
  if (ctx.notes.length > 0) {
    parts.push(`📝 ${ctx.notes.length} note(s) de vos collègues — j'en tiens compte.`);
  }

  parts.push(`\n**Premier critère : ${firstCriterion.label}**`);
  parts.push(`${firstCriterion.description}`);
  parts.push(`\nNotez de **1 à 5** (vous pouvez ajouter un commentaire).`);

  return parts.join('\n');
}

function buildFallbackCriterionPrompt(ctx: CandidateFullContext, criterion: Criterion, idx: number, total: number): string {
  const parts = [`**${idx + 1}/${total} — ${criterion.label}**`];
  parts.push(criterion.description);

  // Add contextual hint based on available data
  if (criterion.category === 'technical' && ctx.scoringDetails?.missing_skills?.length) {
    parts.push(`\n💡 Note : l'IA a identifié des skills manquants : ${ctx.scoringDetails.missing_skills.slice(0, 3).join(', ')}.`);
  }
  if (criterion.suggestedQuestions?.length) {
    parts.push(`\nQuestions suggérées :`);
    criterion.suggestedQuestions.slice(0, 2).forEach(q => parts.push(`- ${q}`));
  }

  parts.push(`\nNotez de **1 à 5**.`);
  return parts.join('\n');
}
