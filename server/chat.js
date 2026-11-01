'use strict';
// Chat orchestration: memory recall -> prompt -> LLM -> expression parse ->
// memory update -> logging. Kept framework-free so tests can drive it
// directly without the HTTP layer.

const { buildSystemPrompt, parseExpression, cleanReply } = require('./prompts');

class ChatController {
  constructor({ config, memory, llm, logger }) {
    this.config = config;
    this.memory = memory;
    this.llm = llm;      // async chat({messages, turn}) -> {content}
    this.logger = logger || (() => {});
    this.turn = 0;
    this.history = [];   // verbatim recent turns for the model context
  }

  async handle(userText) {
    const text = String(userText || '').trim().slice(0, 2000);
    if (!text) return { error: 'empty message' };

    // explicit "remember this: ..." short-circuits into the fact store
    const factText = require('./memory').Memory.extractRemember(text);

    const profile = this.memory.loadProfile();
    const facts = this.memory.recall(text, { limit: 5 });
    if (factText) {
      const res = this.memory.addFact(factText);
      facts.unshift(`(viewer asked me to remember: ${res.added ? 'stored' : 'I already knew it'})`);
    }

    this.history.push({ role: 'user', content: text });
    if (this.history.length > this.config.maxTurns * 2) {
      this.history.splice(0, this.history.length - this.config.maxTurns * 2);
    }

    const system = buildSystemPrompt({
      personaName: this.config.personaName,
      facts,
      userName: profile.userName || 'friend',
    });

    let reply;
    try {
      const res = await this.llm.chat({
        messages: [{ role: 'system', content: system }, ...this.history],
        turn: this.turn,
      });
      reply = res.content;
      this.turn++;
    } catch (err) {
      this.logger(`chat failed: ${err.message}`);
      return {
        error: 'The brain is not answering. ' + err.message,
      };
    }

    const cleaned = cleanReply(reply);
    const { text: spoken, expression } = parseExpression(cleaned);

    this.history.push({ role: 'assistant', content: cleaned });
    if (this.history.length > this.config.maxTurns * 2) {
      this.history.splice(0, this.history.length - this.config.maxTurns * 2);
    }

    this.memory.bumpChat();
    if (expression) this.memory.setMood(expression);

    return {
      reply: spoken || cleaned,
      expression,
      remembered: factText ? { stored: true, text: factText } : null,
    };
  }

  resetHistory() {
    this.history = [];
    this.turn = 0;
  }
}

module.exports = { ChatController };
