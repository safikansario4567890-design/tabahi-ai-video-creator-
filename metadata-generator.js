(function (global) {
  'use strict';

  const titleTemplates = [
    (topic) => `${topic}: the part worth sharing`,
    (topic) => `A quick take on ${topic}`,
    (topic) => `${topic} in under a minute`,
    (topic) => `Watch this before you scroll: ${topic}`
  ];
  const descriptionTemplates = [
    (topic, category) => `A short ${category.toLowerCase()} moment about ${topic}. Save this for later and share it with someone who would enjoy it.`,
    (topic, category) => `A quick look at ${topic}, made for your next scroll break. Explore more ${category.toLowerCase()} clips and tell us what stood out to you.`,
    (topic, category) => `One idea, one short video: ${topic}. Follow along for more ${category.toLowerCase()} highlights.`
  ];
  const categoryTags = {
    Gaming: ['gaming', 'gameplay', 'gamer'],
    Motivation: ['motivation', 'mindset', 'inspiration'],
    Facts: ['facts', 'learnsomething', 'didyouknow'],
    Technology: ['technology', 'tech', 'innovation'],
    Fitness: ['fitness', 'workout', 'health'],
    Education: ['education', 'learning', 'explained'],
    Comedy: ['comedy', 'funny', 'humor'],
    Entertainment: ['entertainment', 'creator', 'viral'],
    Other: ['shortvideo', 'creator', 'watchthis']
  };
  let generation = 0;

  function cleanTopic(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').replace(/[<>]/g, '').slice(0, 80);
  }

  function createHashtag(value) {
    const normalized = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}]/gu, '');
    return normalized ? `#${normalized.toLowerCase()}` : '';
  }

  function generate(options) {
    const topic = cleanTopic(options.topic) || cleanTopic(options.filename) || 'your latest moment';
    const category = categoryTags[options.category] ? options.category : 'Other';
    const titleTemplate = titleTemplates[generation % titleTemplates.length];
    const descriptionTemplate = descriptionTemplates[generation % descriptionTemplates.length];
    generation += 1;

    const keywords = topic.split(/[,;|]+/).map((word) => word.trim()).filter(Boolean);
    const hashtags = [...new Set([
      ...keywords.slice(0, 3).map(createHashtag),
      ...categoryTags[category].slice(0, 2).map(createHashtag),
      '#shorts'
    ])].filter(Boolean).slice(0, 6);

    return {
      title: titleTemplate(topic),
      description: descriptionTemplate(topic, category),
      hashtags: hashtags.join(' ')
    };
  }

  global.TabhiMetadata = { generate };
})(window);
