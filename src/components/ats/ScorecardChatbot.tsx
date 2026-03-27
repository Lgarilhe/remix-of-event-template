import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Bot, Send, RotateCcw, CheckCircle2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { toast } from 'sonner';

interface Criterion {
  id: string;
  label: string;
  category: string;
  weight: number;
}

interface ScorecardChatbotProps {
  criteria: Criterion[];
  jobTitle: string;
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

type ChatPhase = 'welcome' | 'calibration' | 'rating' | 'summary' | 'done';

const RECOMMENDATION_MAP: Record<string, string> = {
  'strong_yes': '✅ Oui absolument',
  'yes': '👍 Oui',
  'maybe': '🤔 À revoir',
  'no': '👎 Non',
  'strong_no': '❌ Non catégorique',
};

export const ScorecardChatbot: React.FC<ScorecardChatbotProps> = ({
  criteria, jobTitle, candidateName, onComplete,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [phase, setPhase] = useState<ChatPhase>('welcome');
  const [currentCriterionIdx, setCurrentCriterionIdx] = useState(0);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Initial welcome message
  useEffect(() => {
    const welcome = `Bonjour ! Je vais vous aider à évaluer **${candidateName}** pour le poste **${jobTitle}**.

On va passer en revue ${criteria.length} critères ensemble. Pour chaque critère, donnez-moi une note de 1 à 5 et un commentaire rapide.

**Prêt ? Commençons par le premier critère.**`;

    setMessages([{ id: 'welcome', role: 'assistant', content: welcome }]);

    // Start first criterion after a short delay
    setTimeout(() => {
      askCriterion(0);
    }, 800);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addMessage = useCallback((role: 'assistant' | 'user', content: string) => {
    setMessages(prev => [...prev, { id: `${role}-${Date.now()}-${Math.random()}`, role, content }]);
  }, []);

  const askCriterion = useCallback((idx: number) => {
    if (idx >= criteria.length) {
      // All criteria rated — generate summary
      setPhase('summary');
      generateSummary();
      return;
    }

    const c = criteria[idx];
    const weightLabel = c.weight === 3 ? '🔴 Critique' : c.weight === 2 ? '🟡 Important' : '🟢 Bonus';
    const categoryLabel = c.category === 'technical' ? 'Technique' : c.category === 'soft_skill' ? 'Soft skills' : c.category === 'culture_fit' ? 'Culture fit' : 'Motivation';

    const msg = `**${idx + 1}/${criteria.length} — ${c.label}**
${weightLabel} · ${categoryLabel}

Sur une échelle de 1 à 5, comment évaluez-vous ce critère ?
- **1** = Très insuffisant
- **2** = Insuffisant
- **3** = Correct
- **4** = Bon
- **5** = Excellent

Vous pouvez aussi ajouter un commentaire après la note (ex: "4 - Bonne maîtrise de React, manque un peu sur les tests").`;

    setPhase('rating');
    setCurrentCriterionIdx(idx);
    addMessage('assistant', msg);
  }, [criteria, addMessage]); // eslint-disable-line react-hooks/exhaustive-deps

  const processUserInput = useCallback((text: string) => {
    if (phase === 'rating') {
      // Extract rating (1-5) from user input
      const ratingMatch = text.match(/^([1-5])/);
      if (!ratingMatch) {
        addMessage('assistant', "Je n'ai pas compris la note. Donnez un chiffre de **1 à 5** suivi d'un commentaire optionnel.");
        return;
      }

      const rating = parseInt(ratingMatch[1]);
      const comment = text.replace(/^[1-5]\s*[-–—:.]?\s*/, '').trim();
      const criterion = criteria[currentCriterionIdx];

      setRatings(prev => ({ ...prev, [criterion.id]: rating }));
      if (comment) setComments(prev => ({ ...prev, [criterion.id]: comment }));

      // Acknowledge
      const ack = rating >= 4
        ? `Noté **${rating}/5** pour ${criterion.label}. ${comment ? `"${comment}"` : ''} 👍`
        : rating >= 3
        ? `Noté **${rating}/5** pour ${criterion.label}. ${comment ? `"${comment}"` : ''}`
        : `Noté **${rating}/5** pour ${criterion.label}. ${comment ? `"${comment}"` : ''} — point à surveiller.`;

      addMessage('assistant', ack);

      // Next criterion
      setTimeout(() => askCriterion(currentCriterionIdx + 1), 600);
    }
  }, [phase, criteria, currentCriterionIdx, addMessage, askCriterion]);

  const generateSummary = useCallback(async () => {
    setIsProcessing(true);
    addMessage('assistant', "Merci pour vos évaluations ! Je prépare le résumé...");

    // Calculate overall score
    let totalWeighted = 0;
    let totalWeight = 0;
    for (const c of criteria) {
      const r = ratings[c.id];
      if (r) {
        totalWeighted += r * c.weight;
        totalWeight += c.weight;
      }
    }
    const overallScore = totalWeight > 0 ? Math.round((totalWeighted / totalWeight) * 10) / 10 : 0;

    // Determine recommendation
    let recommendation = 'maybe';
    if (overallScore >= 4.2) recommendation = 'strong_yes';
    else if (overallScore >= 3.5) recommendation = 'yes';
    else if (overallScore >= 2.5) recommendation = 'maybe';
    else if (overallScore >= 1.5) recommendation = 'no';
    else recommendation = 'strong_no';

    // Build summary
    const strengths = criteria.filter(c => (ratings[c.id] || 0) >= 4).map(c => c.label);
    const weaknesses = criteria.filter(c => (ratings[c.id] || 0) <= 2).map(c => c.label);

    const summary = [
      `Score global : **${overallScore}/5** — ${RECOMMENDATION_MAP[recommendation]}`,
      '',
      strengths.length > 0 ? `**Points forts** : ${strengths.join(', ')}` : '',
      weaknesses.length > 0 ? `**Points faibles** : ${weaknesses.join(', ')}` : '',
      '',
      `Évaluation terminée pour **${candidateName}** sur le poste **${jobTitle}**.`,
    ].filter(Boolean).join('\n');

    addMessage('assistant', summary);
    setPhase('done');
    setIsProcessing(false);

    onComplete({
      ratings,
      comments,
      overallScore,
      recommendation,
      summary: `Score: ${overallScore}/5. Forces: ${strengths.join(', ') || 'N/A'}. Faiblesses: ${weaknesses.join(', ') || 'N/A'}.`,
    });
  }, [criteria, ratings, comments, candidateName, jobTitle, addMessage, onComplete]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isProcessing) return;
    setInput('');
    addMessage('user', text);
    setTimeout(() => processUserInput(text), 200);
  };

  const progress = criteria.length > 0 ? Math.round((Object.keys(ratings).length / criteria.length) * 100) : 0;

  return (
    <div className="border border-foreground/20 flex flex-col h-[500px]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-foreground/20 flex items-center justify-between bg-foreground/5">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-foreground" />
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-foreground">Scorecard guidée</p>
            <p className="text-[9px] text-muted-foreground">{candidateName} · {jobTitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Progress */}
          <div className="flex items-center gap-2">
            <div className="w-16 h-1.5 bg-foreground/10">
              <div className="h-full bg-foreground transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-[9px] font-bold text-muted-foreground">{progress}%</span>
          </div>
          {phase === 'done' && <CheckCircle2 className="w-4 h-4 text-foreground" />}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map(msg => (
          <div key={msg.id} className={cn("flex", msg.role === 'user' ? "justify-end" : "justify-start")}>
            <div className={cn(
              "max-w-[85%] px-3 py-2 text-sm",
              msg.role === 'user'
                ? "bg-foreground text-background"
                : "bg-muted/50 border border-foreground/10 text-foreground"
            )}>
              {msg.content.split('\n').map((line, i) => (
                <p key={i} className={cn("leading-relaxed", i > 0 && "mt-1")}>
                  {line.split(/\*\*(.*?)\*\*/g).map((part, j) =>
                    j % 2 === 1 ? <strong key={j}>{part}</strong> : part
                  )}
                </p>
              ))}
            </div>
          </div>
        ))}
        {isProcessing && (
          <div className="flex justify-start">
            <div className="px-3 py-2 bg-muted/50 border border-foreground/10">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      {phase !== 'done' && (
        <div className="px-4 py-3 border-t border-foreground/20">
          <div className="flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSend(); } }}
              placeholder={phase === 'rating' ? 'Ex: 4 - Bonne maîtrise technique' : 'Votre réponse...'}
              disabled={isProcessing}
              className="flex-1 h-[36px] px-3 text-sm border border-foreground/20 bg-background text-foreground focus:border-foreground focus:outline-none transition-colors disabled:opacity-50"
            />
            {/* Quick rating buttons */}
            {phase === 'rating' && (
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    onClick={() => {
                      setInput('');
                      addMessage('user', String(n));
                      setTimeout(() => processUserInput(String(n)), 200);
                    }}
                    className="w-[36px] h-[36px] text-sm font-bold border border-foreground/20 text-foreground hover:bg-foreground hover:text-background transition-colors"
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={handleSend}
              disabled={!input.trim() || isProcessing}
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
