/* ==========================================================================
   NextLayer — app.js
   API client, shared helpers, default content, landing page, admin dashboard.
   Talks to Cloudflare Pages Functions mounted at /api/site/* .
   ========================================================================== */
(function () {
  'use strict';
  document.documentElement.classList.add('js'); // reveal gating (CSP-safe)

  /* ----------------------------------------------------------------------
     1) API CLIENT
  ---------------------------------------------------------------------- */
  window.site = window.site || {};
  window.site.api = (function () {
    const BASE = '/api/site';
    async function request(method, path, body) {
      const opts = { method, headers: {}, credentials: 'same-origin' };
      if (body !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
      const res = await fetch(BASE + path, opts);
      let data = {};
      try { data = await res.json(); } catch (e) { /* non-JSON */ }
      if (!res.ok || data.ok === false) {
        const err = new Error(data.error || 'Request failed (' + res.status + ')');
        err.status = res.status;
        throw err;
      }
      return data;
    }
    return {
      get: (p) => request('GET', p),
      post: (p, b) => request('POST', p, b),
      put: (p, b) => request('PUT', p, b),
      del: (p) => request('DELETE', p)
    };
  })();

  /* ----------------------------------------------------------------------
     SHARED HELPERS
  ---------------------------------------------------------------------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function arr(v) { return Array.isArray(v) ? v : []; }
  function safeUrl(u, fallback) {
    // Link fields are admin-editable: allow http(s)/mailto:/tel:/anchors and
    // relative URLs; block javascript:/data:/vbscript: and other schemes.
    const fb = fallback || '#';
    const s = String(u == null ? '' : u).trim();
    if (!s || /[\s<>]/.test(s)) return fb;
    if (s.charAt(0) === '#' || s.charAt(0) === '/') return s;
    const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(s);
    if (!m) return s; // bare relative URL (images/x.jpg, page.html, ?q=1)
    const scheme = m[1].toLowerCase();
    return (scheme === 'http' || scheme === 'https' ||
      scheme === 'mailto' || scheme === 'tel') ? s : fb;
  }
  function getPath(o, p) {
    return String(p).split('.').reduce((x, k) => (x == null ? x : x[k]), o);
  }
  function setPath(o, p, v) {
    const ks = String(p).split('.');
    let cur = o;
    for (let i = 0; i < ks.length - 1; i++) {
      if (cur[ks[i]] == null || typeof cur[ks[i]] !== 'object') cur[ks[i]] = {};
      cur = cur[ks[i]];
    }
    cur[ks[ks.length - 1]] = v;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function deepMerge(base, override) {
    // Objects merge key-by-key; arrays and scalars from the override win
    // wholesale — so deleting a list item in admin really removes it.
    const out = Object.assign({}, base);
    Object.keys(override || {}).forEach((k) => {
      const bv = base ? base[k] : undefined;
      const ov = override[k];
      if (Array.isArray(ov)) out[k] = ov.slice();
      else if (ov && typeof ov === 'object' && bv && typeof bv === 'object' && !Array.isArray(bv))
        out[k] = deepMerge(bv, ov);
      else out[k] = ov;
    });
    return out;
  }
  function toast(message, type) {
    const area = document.getElementById('toastArea');
    if (!area) return;
    const el = document.createElement('div');
    el.className = 'toast ' + (type === 'err' ? 'err' : 'ok');
    el.innerHTML = (type === 'err' ? ICON_OK_ERR[1] : ICON_OK_ERR[0]) +
      '<span>' + esc(message) + '</span>';
    area.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0'; el.style.transition = 'opacity .3s';
      setTimeout(() => el.remove(), 300);
    }, 3400);
  }
  function timeAgo(iso) {
    if (!iso) return '–';
    const d = new Date(String(iso).replace(' ', 'T') + (String(iso).includes('Z') ? '' : 'Z'));
    if (isNaN(d.getTime())) return '–';
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 86400 * 30) return Math.floor(diff / 86400) + 'd ago';
    return d.toLocaleDateString();
  }
  const ICON_OK_ERR = [
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 5-6"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><circle cx="12" cy="16.5" r=".5"/></svg>'
  ];

  /* ----------------------------------------------------------------------
     2) ICON REGISTRY (curated set — admin picks by name, no icon font)
  ---------------------------------------------------------------------- */
  const ICONS = {};
  ICONS['code'] = { fill: false, sw: '1.6', body: '<path d="m8 8-5 4 5 4"/><path d="m16 8 5 4-5 4"/><path d="M13.5 4 10.5 20"/>' };
  ICONS['app'] = { fill: false, sw: '1.6', body: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9.5h18"/><path d="M6 6.8h.01M9 6.8h.01"/>' };
  ICONS['pen'] = { fill: false, sw: '1.6', body: '<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/>' };
  ICONS['cpu'] = { fill: false, sw: '1.6', body: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>' };
  ICONS['search'] = { fill: false, sw: '1.6', body: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.5-4.5"/><path d="M8 12l2-2.5 1.8 1.8L14.5 8"/>' };
  ICONS['settings'] = { fill: false, sw: '1.6', body: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' };
  ICONS['sparkles'] = { fill: false, sw: '1.6', body: '<path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>' };
  ICONS['target'] = { fill: false, sw: '1.6', body: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>' };
  ICONS['zap'] = { fill: false, sw: '1.6', body: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>' };
  ICONS['layers'] = { fill: false, sw: '1.6', body: '<path d="m12 2 9 4.9-9 4.9-9-4.9z"/><path d="m3 11.9 9 4.9 9-4.9"/><path d="m3 16.9 9 4.9 9-4.9"/>' };
  ICONS['lock'] = { fill: false, sw: '1.6', body: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>' };
  ICONS['headphones'] = { fill: false, sw: '1.6', body: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>' };
  ICONS['x'] = { fill: true, sw: 'None', body: '<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>' };
  ICONS['linkedin'] = { fill: true, sw: 'None', body: '<path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125zM7.119 20.452H3.554V9h3.565v11.452z"/>' };
  ICONS['github'] = { fill: true, sw: 'None', body: '<path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>' };
  ICONS['instagram'] = { fill: false, sw: '1.8', body: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none"/>' };
  ICONS['check'] = { fill: false, sw: '2', body: '<path d="m4.5 12.5 5 5 10-11"/>' };
  ICONS['arrow'] = { fill: false, sw: '1.8', body: '<path d="M4 12h15"/><path d="m13 6 6 6-6 6"/>' };
  ICONS['link'] = { fill: false, sw: '1.6', body: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>' };
  function icon(name, attrs) {
    const d = ICONS[name] || ICONS.link;
    const paint = d.fill
      ? ' fill="currentColor"'
      : ' fill="none" stroke="currentColor" stroke-width="' + (d.sw || '1.6') +
        '" stroke-linecap="round" stroke-linejoin="round"';
    return '<svg viewBox="0 0 24 24"' + paint + ' aria-hidden="true"' +
      (attrs ? ' ' + attrs : '') + '>' + d.body + '</svg>';
  }
  const SOCIAL_LABELS = {
    x: 'X (Twitter)', linkedin: 'LinkedIn', github: 'GitHub',
    instagram: 'Instagram', link: 'Website'
  };
  function socialLabel(n) {
    if (SOCIAL_LABELS[n]) return SOCIAL_LABELS[n];
    return String(n || 'link').charAt(0).toUpperCase() + String(n || 'link').slice(1);
  }

  /* ----------------------------------------------------------------------
     3) DEFAULT CONTENT (also the admin "demo content"; mirrors the
        static fallback copy in index.html, so first paint needs no API)
  ---------------------------------------------------------------------- */
  const DEFAULTS = {
    brand: { name: "NextLayer", href: "#" },
    meta: {
      title: "The Next Layer of Intelligence",
      description: "NextLayer — websites, web applications, UI/UX design and custom software. Premium design, modern engineering, ongoing support."
    },
    nav: {
      links: [
        { label: "About", href: "#" },
        { label: "Features", href: "#" },
        { label: "FAQ", href: "#" },
        { label: "Contact", href: "#" }
      ],
      cta_label: "Get Started", cta_href: "#"
    },
    menu: {
      eyebrow: "Menu",
      cta_label: "Get Started", cta_href: "#",
      ghost_label: "View Architecture", ghost_href: "#"
    },
    hero: {
      title_1: "The Next Layer",
      title_2: "of Intelligence",
      sub_1: "A unified infrastructure platform to help teams build,",
      sub_2: "ship, and scale AI systems with confidence.",
      cta_primary: "Get Started", cta_primary_href: "#",
      cta_secondary: "View Architecture", cta_secondary_href: "#",
      video_url: "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260808_112712_da9d53df-6d27-4b12-bdf6-aa9dc2622bdf.mp4"
    },
    strip: { visible: true, words: ["logoipsum", "logoipsum", "logoipsum", "logoipsum"] },
    trusted: {
      visible: true,
      eyebrow: "Trusted by",
      title: "Teams that ship with confidence",
      sub: "From funded startups to established enterprises, product teams rely on us to design, build, and scale their digital platforms.",
      stats: [
        { value: "120+", label: "Projects delivered across web and cloud" },
        { value: "45+", label: "Clients worldwide, from startups to enterprises" },
        { value: "8+", label: "Years of design and engineering experience" },
        { value: "99.9%", label: "Average uptime across maintained platforms" }
      ],
      points: ["Enterprise-ready delivery", "SEO-first builds", "Performance obsessed", "Ongoing support"]
    },
    services: {
      visible: true,
      eyebrow: "Services",
      title: "What we build for you",
      sub: "End-to-end design, development, and growth services — one senior team for your entire digital product.",
      more_label: "Not sure what you need? Let’s discuss",
      items: [
        { icon: "code", title: "Website Development", desc: "Lightning-fast marketing sites and business websites with clean code, responsive layouts, and easy content management." },
        { icon: "app", title: "Web Application Development", desc: "Dashboards, portals, and SaaS products with secure APIs, role-based access, and architecture that scales." },
        { icon: "pen", title: "UI/UX Design", desc: "Research-backed wireframes, prototypes, and design systems that look premium and turn visitors into customers." },
        { icon: "cpu", title: "Custom Software", desc: "Internal tools, automations, and integrations tailored to the way your business actually works." },
        { icon: "search", title: "SEO", desc: "Technical audits, on-page optimization, and performance tuning that move your rankings in the right direction." },
        { icon: "settings", title: "Maintenance & Support", desc: "Monitoring, updates, backups, and priority fixes — so your site stays fast, secure, and online." }
      ]
    },
    work: {
      visible: true,
      eyebrow: "Selected work",
      title: "Featured projects",
      sub: "A few recent builds — each one designed, engineered, and launched by our team.",
      view_label: "View Project",
      items: [
        { tag: "AI Analytics Platform", name: "Pulseboard", desc: "Real-time dashboards processing millions of events with sub-second queries — and an interface the whole company actually enjoys using.", tech: ["Next.js", "Python", "PostgreSQL", "AWS"], image: "images/proj-1.jpg", alt: "Pulseboard analytics dashboard interface", link: "#" },
        { tag: "Fintech Portal", name: "Northbeam", desc: "A secure client portal with onboarding, statements, and instant transfers — audited, accessible, and tuned for conversion.", tech: ["React", "Node.js", "MongoDB", "Stripe"], image: "images/proj-2.jpg", alt: "Northbeam digital banking portal interface", link: "#" },
        { tag: "Telehealth Platform", name: "MediSync", desc: "Scheduling, video visits, and patient records in one calm interface — secure by design, from database to UI.", tech: ["Next.js", "Node.js", "WebRTC", "AWS"], image: "images/proj-3.jpg", alt: "MediSync telehealth platform interface", link: "#" }
      ]
    },
    why: {
      visible: true,
      eyebrow: "Why choose us",
      title: "Built different, on purpose",
      sub: "The details other agencies treat as extras are our starting point.",
      items: [
        { icon: "sparkles", title: "Modern Design", desc: "Clean, premium interfaces that make your brand look established from day one." },
        { icon: "target", title: "Business-Focused Development", desc: "Every feature mapped to revenue, efficiency, or growth — never tech for tech’s sake." },
        { icon: "zap", title: "Performance", desc: "Sub-second loads and top Core Web Vitals scores as standard — not an upsell." },
        { icon: "layers", title: "Scalability", desc: "Architecture that handles ten users or ten million without a rewrite." },
        { icon: "lock", title: "Security", desc: "Hardened auth, encrypted data, and safe defaults baked into every build." },
        { icon: "headphones", title: "Support", desc: "Real humans, fast replies, and proactive monitoring long after launch." }
      ]
    },
    stack: {
      visible: true,
      eyebrow: "Technology",
      title: "A modern, proven stack",
      sub: "Boring-reliable tools that hire well, scale easily, and stay maintainable for years.",
      cols: [
        { title: "Frontend", items: ["React", "Next.js", "TypeScript", "Tailwind CSS"] },
        { title: "Backend", items: ["Node.js", "Python", "REST & GraphQL", "Auth & Payments"] },
        { title: "Data & AI", items: ["PostgreSQL", "MongoDB", "Redis", "AI Integrations"] },
        { title: "Cloud & DevOps", items: ["AWS", "Vercel", "Docker", "CI/CD Pipelines"] }
      ]
    },
    pricing: {
      visible: true,
      eyebrow: "Pricing",
      title: "Simple packages, honest scope",
      sub: "Every project is different — these packages show what’s typically included. Final quotes always depend on scope.",
      note_text: "Need something else? Every quote is tailored —",
      note_link: "talk to us",
      note_suffix: "and get a clear, itemized estimate.",
      plans: [
        { name: "Starter", flag: "", desc: "For landing pages and small business sites.", features: ["Up to 5 custom-designed pages", "Mobile-first, responsive build", "On-page SEO essentials", "Contact forms & analytics", "30 days of free support"], cta: "Let’s Discuss", link: "#contact", cta_style: "outline", featured: false },
        { name: "Business", flag: "Most Popular", desc: "For growing companies that need room to scale.", features: ["Up to 15 pages + CMS", "Blog & advanced SEO setup", "CRM & payment integrations", "Core Web Vitals tuning", "90 days priority support"], cta: "Get a Quote", link: "#contact", cta_style: "solid", featured: true },
        { name: "Custom Web Application", flag: "", desc: "For dashboards, portals, and SaaS products.", features: ["Custom UX & interface design", "Secure backend & APIs", "Roles, dashboards & reports", "Third-party integrations", "Testing, docs & training"], cta: "Get a Quote", link: "#contact", cta_style: "outline", featured: false }
      ]
    },
    faq: {
      visible: true,
      eyebrow: "FAQ",
      title: "Questions, answered",
      sub: "The essentials on timelines, pricing, hosting, and working together.",
      items: [
        { q: "How long does it take to build a website?", a: "A typical business site takes 2–4 weeks from kickoff to launch. Larger platforms and web applications usually run 6–12+ weeks depending on scope. You’ll always get a clear timeline with milestones before we start." },
        { q: "How much does a project cost?", a: "It depends on scope, pages, integrations, and custom functionality. The packages above show what’s typically included — every quote is itemized with no hidden fees. Share your requirements and we’ll send a tailored estimate, usually within 48 hours." },
        { q: "Do you provide hosting and domains?", a: "Yes. We deploy on reliable cloud infrastructure with SSL, backups, and monitoring configured from day one. Prefer to own everything? We’ll deploy to your accounts and hand over full documentation." },
        { q: "Will my website rank on Google?", a: "Every build ships SEO-ready: semantic markup, meta tags, sitemaps, and speed optimization. For competitive keywords we offer ongoing SEO retainers covering content, technical improvements, and reporting." },
        { q: "Do you offer maintenance after launch?", a: "Yes — care plans cover updates, security patches, backups, uptime monitoring, and small content changes, with priority support when something urgent comes up." },
        { q: "Can you build custom software, not just websites?", a: "Absolutely. Dashboards, customer portals, internal tools, APIs, and SaaS MVPs are a core part of what we do — designed around your workflow, not forced into a template." },
        { q: "Can you redesign my existing website?", a: "Yes. We start with an audit of your current site, keep what works — content, structure, and rankings — then modernize the design and stack without breaking links or losing SEO equity." }
      ]
    },
    cta: {
      visible: true,
      title: "Have an idea? Let’s build it.",
      sub: "Tell us where you want to go — we’ll reply within 24 hours with honest advice, a plan, and a clear quote.",
      primary: "Start a Project",
      primary_href: "mailto:hello@nextlayer.studio?subject=New%20project%20inquiry",
      secondary: "Get a Quote",
      secondary_href: "mailto:hello@nextlayer.studio?subject=Quote%20request",
      note_prefix: "Prefer email?",
      email: "hello@nextlayer.studio",
      note_suffix: "· Replies within 24 hours"
    },
    contact_form: {
      visible: true,
      title: "Or send a message",
      name_ph: "Your name",
      email_ph: "Email address",
      message_ph: "Tell us about your project…",
      button: "Send message",
      success: "Thanks — your message is in. We’ll reply within 24 hours.",
      error: "Couldn’t send. Please try again or email us directly."
    },
    footer: {
      visible: true,
      desc: "A web design and development studio crafting fast, scalable, search-ready digital products for ambitious teams worldwide.",
      avail_label: "Available for new projects",
      rights: "All rights reserved.",
      socials: [
        { network: "x", href: "#" },
        { network: "linkedin", href: "#" },
        { network: "github", href: "#" },
        { network: "instagram", href: "#" }
      ],
      company_links: [
        { label: "About", href: "#why-us" },
        { label: "Work", href: "#work" },
        { label: "Pricing", href: "#pricing" },
        { label: "FAQ", href: "#faq" }
      ],
      service_links: [
        { label: "Website Development", href: "#services" },
        { label: "Web Applications", href: "#services" },
        { label: "UI/UX Design", href: "#services" },
        { label: "Custom Software", href: "#services" },
        { label: "SEO", href: "#services" },
        { label: "Maintenance & Support", href: "#services" }
      ],
      contact_links: [
        { label: "hello@nextlayer.studio", href: "mailto:hello@nextlayer.studio" },
        { label: "Start a project", href: "#contact" },
        { label: "Get a quote", href: "#contact" }
      ],
      legal: [
        { label: "Privacy Policy", href: "#" },
        { label: "Terms of Service", href: "#" }
      ]
    }
  };
  window.SITE_DEFAULTS = DEFAULTS;

  /* ======================================================================
     4) LANDING PAGE (only runs on index.html — guarded by body class)
  ====================================================================== */
  const Landing = (function () {
    let content = clone(DEFAULTS); // static HTML already matches DEFAULTS
    let io = null;

    function applyScalars() {
      $$('[data-c]').forEach((el) => {
        const v = getPath(content, el.dataset.c);
        const s = v == null ? '' : String(v); // missing path clears stale text
        if (el.textContent !== s) el.textContent = s;
      });
      $$('[data-c-text]').forEach((el) => { // first text node only (keeps child markup)
        const v = getPath(content, el.dataset.cText);
        const s = v == null ? '' : String(v);
        const n = el.firstChild;
        if (n && n.nodeType === 3) { if (n.nodeValue !== s) n.nodeValue = s; }
        else if (s) el.insertAdjacentText('afterbegin', s);
      });
      $$('[data-c-href]').forEach((el) => {
        const v = safeUrl(getPath(content, el.dataset.cHref), el.getAttribute('href') || '#');
        if (el.getAttribute('href') !== v) el.setAttribute('href', v);
      });
      $$('[data-c-src]').forEach((el) => {
        const v = getPath(content, el.dataset.cSrc);
        if (v == null || el.getAttribute('src') === String(v)) return;
        el.setAttribute('src', v);
        const vid = el.closest('video');
        if (vid && vid.load) { try { vid.load(); } catch (e) { /* ignore */ } }
      });
      $$('[data-c-mailto]').forEach((el) => {
        const v = getPath(content, el.dataset.cMailto);
        if (v == null) return;
        const href = 'mailto:' + v;
        if (el.getAttribute('href') !== href) el.setAttribute('href', href);
        if (el.textContent !== String(v)) el.textContent = v;
      });
      $$('[data-c-ph]').forEach((el) => {
        const v = getPath(content, el.dataset.cPh);
        if (v != null && el.getAttribute('placeholder') !== String(v))
          el.setAttribute('placeholder', v);
      });
      $$('[data-visible]').forEach((el) => {
        el.classList.toggle('hidden', getPath(content, el.dataset.visible) === false);
      });
      const md = document.querySelector('meta[name="description"]');
      if (md && content.meta && content.meta.description != null &&
          md.getAttribute('content') !== content.meta.description)
        md.setAttribute('content', content.meta.description);
    }

    /* ---------- list templates (mirror the static fallback markup) ---------- */
    function d012(i) { return i === 0 ? '' : ' rv-d' + Math.min(i, 3); }
    function renderNav(el, items) {
      if (el.dataset.template === 'menu') {
        el.innerHTML = items.map((l) =>
          '<li><a href="' + esc(safeUrl((l || {}).href)) + '">' + esc((l || {}).label || '') + '</a></li>').join('');
      } else {
        el.innerHTML = items.map((l) =>
          '<a href="' + esc(safeUrl((l || {}).href)) + '">' + esc((l || {}).label || '') + '</a>').join('');
      }
    }
    function renderStats(el, items) {
      el.innerHTML = items.map((s, i) =>
        '<div class="stat rv' + d012(i) + '"><b>' + esc(s.value) + '</b><span>' +
        esc(s.label) + '</span></div>').join('');
    }
    function renderPoints(el, items) {
      el.innerHTML = items.map((p) => '<i>' + esc(p) + '</i>').join('');
    }
    function renderServices(el, items) {
      const cyc = ['', ' rv-d1', ' rv-d2'];
      el.innerHTML = items.map((s, i) =>
        '<article class="svc rv' + cyc[i % 3] + '"><div class="svc-top"><span class="svc-ic">' +
        icon(s.icon) + '</span><span class="svc-num">' + ('0' + (i + 1)).slice(-2) +
        '</span></div><h3>' + esc(s.title) + '</h3><p>' + esc(s.desc || '') + '</p></article>').join('');
    }
    function renderProjects(el, items) {
      const view = (content.work && content.work.view_label) || 'View Project';
      el.innerHTML = items.map((raw) => {
        const p = raw || {};
        const media = p.image
          ? '<div class="proj-media"><img src="' + esc(p.image) +
            '" alt="' + esc(p.alt || p.name || '') + '" loading="lazy" width="1200" height="750"></div>'
          : '<div class="proj-media"></div>';
        return '<article class="proj rv">' + media +
          '<div class="proj-body"><p class="proj-tag">' + esc(p.tag || '') + '</p><h3>' +
          esc(p.name || '') + '</h3><p>' + esc(p.desc || '') + '</p>' +
          '<ul class="proj-tech">' + arr(p.tech).map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>' +
          '<a class="g-link sm" href="' + esc(safeUrl(p.link)) + '">' + esc(view) + ' ' +
          icon('arrow', 'width="17" height="17"') + '</a></div></article>';
      }).join('');
    }
    function renderWhy(el, items) {
      el.innerHTML = items.map((w, i) =>
        '<div class="why rv' + (i % 2 ? ' rv-d1' : '') + '"><span class="why-ic">' + icon(w.icon) +
        '</span><div><h3>' + esc(w.title) + '</h3><p>' + esc(w.desc || '') + '</p></div></div>').join('');
    }
    function renderStack(el, cols) {
      el.innerHTML = cols.map((c, i) =>
        '<div class="stack-col rv' + d012(i) + '"><h3>' + esc(c.title) + '</h3><ul>' +
        arr(c.items).map((it) => '<li>' + esc(it) + '</li>').join('') + '</ul></div>').join('');
    }
    function renderPlans(el, plans) {
      el.innerHTML = plans.map((p, i) =>
        '<div class="price' + (p.featured ? ' feat' : '') + ' rv' + d012(i) + '">' +
        (p.flag ? '<span class="price-flag">' + esc(p.flag) + '</span>' : '') +
        '<h3>' + esc(p.name || '') + '</h3><p class="for">' + esc(p.desc || '') + '</p><ul>' +
        arr(p.features).map((f) => '<li>' + icon('check', 'width="18" height="18"') + esc(f) + '</li>').join('') +
        '</ul><a class="pill btn-sm' + (p.cta_style === 'solid' ? '' : ' btn-outline') +
        '" href="' + esc(safeUrl(p.link, '#contact')) + '"><span>' + esc(p.cta || 'Get a Quote') +
        '</span></a></div>').join('');
    }
    function renderFaq(el, items) {
      el.innerHTML = items.map((f) =>
        '<div class="faq-item"><button type="button" class="faq-q" aria-expanded="false">' +
        esc(f.q) + '</button><div class="faq-a"><p>' + esc(f.a || '') + '</p></div></div>').join('');
    }
    function renderSocials(el, items) {
      el.innerHTML = items.map((s) => {
        const href = safeUrl((s || {}).href);
        const ext = /^https?:\/\//i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
        return '<a href="' + esc(href) + '" aria-label="' + esc(socialLabel(s.network)) + '"' +
          ext + '>' + icon(s.network || 'link') + '</a>';
      }).join('');
    }
    function renderLinkList(el, items) {
      el.innerHTML = items.map((l) =>
        '<li><a href="' + esc(safeUrl((l || {}).href)) + '">' + esc((l || {}).label || '') + '</a></li>').join('');
    }
    function renderLegal(el, items) {
      el.innerHTML = items.map((l) =>
        '<a href="' + esc(safeUrl((l || {}).href)) + '">' + esc((l || {}).label || '') + '</a>').join('');
    }
    const LIST_RENDERERS = {
      'nav.links': renderNav,
      'trusted.stats': renderStats,
      'trusted.points': renderPoints,
      'services.items': renderServices,
      'work.items': renderProjects,
      'why.items': renderWhy,
      'stack.cols': renderStack,
      'pricing.plans': renderPlans,
      'faq.items': renderFaq,
      'footer.socials': renderSocials,
      'footer.company_links': renderLinkList,
      'footer.service_links': renderLinkList,
      'footer.contact_links': renderLinkList,
      'footer.legal': renderLegal
    };
    function renderLists() {
      Object.keys(LIST_RENDERERS).forEach((key) => {
        const v = getPath(content, key);
        if (!Array.isArray(v)) return;
        $$('[data-list="' + key + '"]').forEach((el) => LIST_RENDERERS[key](el, v.filter((x) => x != null)));
      });
      observeReveals();
    }
    function renderContent() { applyScalars(); renderLists(); }

    /* ---------- interactions ---------- */
    function observeReveals() {
      const els = $$('.rv:not([data-obs])');
      if (!('IntersectionObserver' in window) || !io) {
        els.forEach((el) => { el.setAttribute('data-obs', '1'); el.classList.add('in'); });
        return;
      }
      els.forEach((el) => { el.setAttribute('data-obs', '1'); io.observe(el); });
    }
    function initObservers() {
      if (!('IntersectionObserver' in window)) { observeReveals(); return; }
      io = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
      observeReveals();
    }
    function initHeader() {
      const topbar = document.querySelector('.topbar');
      if (!topbar) return;
      const onScroll = () => topbar.classList.toggle('scrolled', window.scrollY > 10);
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }
    function initMenu() {
      const stage = document.querySelector('.stage');
      const burger = document.getElementById('burger');
      const menu = document.getElementById('menu');
      if (!stage || !burger) return;
      const close = () => {
        document.body.classList.remove('menu-open');
        burger.setAttribute('aria-expanded', 'false');
        if (menu) menu.setAttribute('aria-hidden', 'true');
      };
      burger.addEventListener('click', () => {
        const open = document.body.classList.toggle('menu-open');
        burger.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (menu) menu.setAttribute('aria-hidden', open ? 'false' : 'true');
      });
      // delegated so it survives API re-renders of the link list
      const list = document.querySelector('.menu-list');
      if (list) list.addEventListener('click', (e) => { if (e.target.closest('a')) close(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    }
    function initFaq() {
      const wrap = $('[data-list="faq.items"]');
      if (!wrap) return;
      wrap.addEventListener('click', (e) => {
        const btn = e.target.closest('.faq-q');
        if (!btn || !wrap.contains(btn)) return;
        const item = btn.closest('.faq-item');
        const willOpen = btn.getAttribute('aria-expanded') !== 'true';
        $$('.faq-q', wrap).forEach((b) => b.setAttribute('aria-expanded', 'false'));
        $$('.faq-item', wrap).forEach((it) => it.classList.remove('open'));
        if (willOpen) {
          btn.setAttribute('aria-expanded', 'true');
          if (item) item.classList.add('open');
        }
      });
    }
    function initContactForm() {
      const form = document.getElementById('cForm');
      if (!form) return;
      const status = document.getElementById('cStatus');
      const btn = document.getElementById('cSubmit');
      const setStatus = (msg, cls) => {
        if (!status) return;
        status.textContent = msg;
        status.className = 'cform-status' + (cls ? ' ' + cls : '');
      };
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        setStatus('');
        // NB: form.name would return the form's own name attribute — use elements.
        const field = (n) => form.elements.namedItem(n);
        const val = (n) => { const el = field(n); return el && el.value ? el.value.trim() : ''; };
        const name = val('name');
        const email = val('email');
        const message = val('message');
        if (!name || !email || !message) { setStatus('Please fill in every field.', 'err'); return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { setStatus('Please enter a valid email.', 'err'); return; }
        const cf = content.contact_form || {};
        const label = btn ? btn.querySelector('span') : null;
        const orig = label ? label.textContent : '';
        if (btn) btn.disabled = true;
        if (label) label.textContent = 'Sending…';
        try {
          await window.site.api.post('/messages', {
            name, email, message, website: val('website') // honeypot
          });
          form.reset();
          setStatus(cf.success || 'Message sent.', 'ok');
        } catch (err2) {
          setStatus(err2.message || cf.error || 'Could not send.', 'err');
        } finally {
          if (btn) btn.disabled = false;
          if (label) label.textContent = orig;
        }
      });
    }
    async function load() {
      // Static HTML already shows DEFAULTS; only re-render when saved content differs.
      try {
        const data = await window.site.api.get('/content');
        const saved = (data && data.content) ? data.content : {};
        const merged = deepMerge(clone(DEFAULTS), saved);
        if (JSON.stringify(merged) !== JSON.stringify(content)) {
          content = merged;
          renderContent();
        }
      } catch (e) { /* offline / API missing — defaults stay in place */ }
    }
    function init() {
      initObservers();
      initHeader();
      initMenu();
      initFaq();
      initContactForm();
      const yr = document.getElementById('yr');
      if (yr) yr.textContent = String(new Date().getFullYear());
      load();
    }
    return { init };
  })();

  /* ======================================================================
     5) ADMIN — login / setup / dashboard on admin.html
  ====================================================================== */
  const Admin = (function () {
    let content = null, messages = [], currentUser = null, LIST_DEFS = null;

    function linkPair(key, labelPh) {
      return {
        container: $('[data-list="' + key + '"]'),
        blank: { label: '', href: '#' },
        fields: [
          { key: 'label', placeholder: labelPh || 'Label' },
          { key: 'href', placeholder: 'Link or #anchor' }
        ],
        read: (i) => ({ label: i.label.value.trim(), href: i.href.value.trim() || '#' })
      };
    }
    function buildListDefs() {
      return {
        'nav.links': linkPair('nav.links', 'Label e.g. Work'),
        'strip.words': {
          container: $('[data-list="strip.words"]'), blank: '',
          fields: [{ key: 'text', placeholder: 'Strip word' }],
          read: (i) => i.text.value.trim()
        },
        'trusted.stats': {
          container: $('[data-list="trusted.stats"]'), blank: { value: '', label: '' },
          fields: [
            { key: 'value', placeholder: 'Value e.g. 120+', narrow: true },
            { key: 'label', placeholder: 'Label' }
          ],
          read: (i) => ({ value: i.value.value.trim(), label: i.label.value.trim() })
        },
        'trusted.points': {
          container: $('[data-list="trusted.points"]'), blank: '',
          fields: [{ key: 'text', placeholder: 'Trust point e.g. SEO-first builds' }],
          read: (i) => i.text.value.trim()
        },
        'services.items': {
          container: $('[data-list="services.items"]'), blank: { icon: 'code', title: '', desc: '' },
          fields: [
            { key: 'icon', placeholder: 'Icon', icon: true, narrow: true },
            { key: 'title', placeholder: 'Service title' },
            { key: 'desc', placeholder: 'Short description', long: true }
          ],
          read: (i) => ({
            icon: i.icon.value.trim() || 'code',
            title: i.title.value.trim(), desc: i.desc.value.trim()
          })
        },
        'why.items': {
          container: $('[data-list="why.items"]'), blank: { icon: 'sparkles', title: '', desc: '' },
          fields: [
            { key: 'icon', placeholder: 'Icon', icon: true, narrow: true },
            { key: 'title', placeholder: 'Reason title' },
            { key: 'desc', placeholder: 'Short description', long: true }
          ],
          read: (i) => ({
            icon: i.icon.value.trim() || 'sparkles',
            title: i.title.value.trim(), desc: i.desc.value.trim()
          })
        },
        'faq.items': {
          container: $('[data-list="faq.items"]'), blank: { q: '', a: '' },
          fields: [
            { key: 'q', placeholder: 'Question' },
            { key: 'a', placeholder: 'Answer', long: true }
          ],
          read: (i) => ({ q: i.q.value.trim(), a: i.a.value.trim() })
        },
        'stack.cols': {
          container: $('[data-list="stack.cols"]'), blank: { title: '', items: [] },
          fields: [
            { key: 'title', placeholder: 'Column title', narrow: true },
            { key: 'items', placeholder: 'Items, comma separated' }
          ],
          read: (i) => ({
            title: i.title.value.trim(),
            items: i.items.value.split(',').map((s) => s.trim()).filter(Boolean)
          })
        },
        'footer.socials': {
          container: $('[data-list="footer.socials"]'), blank: { network: 'link', href: '' },
          fields: [
            { key: 'network', placeholder: 'Network', icon: true, narrow: true },
            { key: 'href', placeholder: 'https://…' }
          ],
          read: (i) => ({
            network: i.network.value.trim() || 'link', href: i.href.value.trim() || '#'
          })
        },
        'footer.company_links': linkPair('footer.company_links', 'Label e.g. About'),
        'footer.service_links': linkPair('footer.service_links', 'Label e.g. SEO'),
        'footer.contact_links': linkPair('footer.contact_links', 'Label'),
        'footer.legal': linkPair('footer.legal', 'Label e.g. Privacy Policy')
      };
    }
    function makeListRow(def, item) {
      const row = document.createElement('div');
      row.className = 'editor-row';
      const inputs = {};
      def.fields.forEach((f) => {
        let inp;
        const src = (item && typeof item === 'object' && !Array.isArray(item)) ? item
          : (typeof item === 'string' ? { text: item } : {});
        const raw = Array.isArray(src[f.key]) ? src[f.key].join(', ')
          : (src[f.key] != null ? src[f.key] : '');
        if (f.long) {
          inp = document.createElement('textarea');
          inp.rows = 2;
        } else {
          inp = document.createElement('input');
          inp.type = 'text';
          inp.className = f.narrow ? 'w-narrow' : '';
          if (f.icon) {
            inp.setAttribute('list', 'iconNames');
            inp.className += (inp.className ? ' ' : '') + 'icon-input';
          }
        }
        inp.placeholder = f.placeholder || '';
        inp.value = raw;
        inp.dataset.key = f.key;
        if (f.icon) {
          const wrap = document.createElement('span');
          wrap.className = 'icon-field';
          const prev = document.createElement('span');
          prev.className = 'icon-prev';
          const paint = () => { prev.innerHTML = icon(inp.value.trim() || 'link'); };
          inp.addEventListener('input', paint);
          paint();
          wrap.appendChild(prev);
          wrap.appendChild(inp);
          row.appendChild(wrap);
        } else {
          row.appendChild(inp);
        }
        inputs[f.key] = inp;
      });
      const moves = document.createElement('span');
      moves.className = 'row-moves';
      [['↑', 'Move up', () => {
        const p = row.previousElementSibling;
        if (p) row.parentNode.insertBefore(row, p);
      }], ['↓', 'Move down', () => {
        const n = row.nextElementSibling;
        if (n) row.parentNode.insertBefore(n, row);
      }], ['✕', 'Remove', () => row.remove()]].forEach(([g, label, fn], idx) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'icon-btn' + (idx === 2 ? ' danger' : '');
        b.title = label;
        b.textContent = g;
        b.addEventListener('click', fn);
        moves.appendChild(b);
      });
      row.appendChild(moves);
      return row;
    }
    function renderList(key) {
      const def = LIST_DEFS[key];
      if (!def || !def.container) return;
      let data = getPath(content, key);
      if (!Array.isArray(data)) data = [];
      def.container.innerHTML = '';
      data.forEach((item) => def.container.appendChild(makeListRow(def, item)));
    }
    function readList(key) {
      const def = LIST_DEFS[key];
      if (!def || !def.container) return [];
      const out = [];
      $$('.editor-row', def.container).forEach((row) => {
        const inputs = {};
        const fields = $$('input, textarea', row);
        fields.forEach((inp) => { inputs[inp.dataset.key] = inp; });
        // Blank = the admin typed nothing at all. Judged on raw inputs, since
        // read() fills defaults (icon, network, href) that must not keep
        // phantom rows alive — nor swallow href-only rows.
        if (fields.every((inp) => inp.value.trim() === '')) return;
        out.push(def.read(inputs));
      });
      return out;
    }

    /* ---------- card editors (projects, pricing plans) ---------- */
    function txt(val, ph) {
      const i = document.createElement('input');
      i.type = 'text'; i.value = val || ''; i.placeholder = ph || '';
      return i;
    }
    function area(val, ph, rows) {
      const a = document.createElement('textarea');
      a.value = val || ''; a.placeholder = ph || ''; a.rows = rows || 3;
      return a;
    }
    function fld(label, input, full) {
      const w = document.createElement('div');
      w.className = 'field' + (full ? ' full' : '');
      const l = document.createElement('label');
      l.textContent = label;
      w.appendChild(l);
      w.appendChild(input);
      return w;
    }
    function cardShell(ord) {
      const card = document.createElement('div');
      card.className = 'card-editor';
      const head = document.createElement('div');
      head.className = 'card-head';
      const t = document.createElement('strong');
      t.className = 'card-title';
      t.textContent = ord;
      const acts = document.createElement('span');
      acts.className = 'row-moves';
      [['↑', 'Move up', () => {
        const p = card.previousElementSibling;
        if (p) { card.parentNode.insertBefore(card, p); renumberCards(); }
      }], ['↓', 'Move down', () => {
        const n = card.nextElementSibling;
        if (n) { card.parentNode.insertBefore(n, card); renumberCards(); }
      }], ['✕', 'Remove', () => { card.remove(); renumberCards(); }]].forEach(([g, label, fn], idx) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'icon-btn' + (idx === 2 ? ' danger' : '');
        b.title = label;
        b.textContent = g;
        b.addEventListener('click', fn);
        acts.appendChild(b);
      });
      head.appendChild(t);
      head.appendChild(acts);
      card.appendChild(head);
      return card;
    }
    function renumberCards() {
      $$('[data-cards]').forEach((box) => {
        const prefix = box.dataset.cards === 'work.items' ? 'Project ' : 'Plan ';
        $$('.card-editor', box).forEach((c, i) => {
          const t = $('.card-title', c);
          if (t) t.textContent = prefix + (i + 1);
        });
      });
    }
    function makeWorkCard(it) {
      const p = it || {};
      const card = cardShell('Project');
      const grid = document.createElement('div');
      grid.className = 'form-grid';
      const tag = txt(p.tag, 'e.g. Fintech Portal'); tag.dataset.k = 'tag';
      const name = txt(p.name, 'e.g. Northbeam'); name.dataset.k = 'name';
      const image = txt(p.image, 'images/proj-1.jpg'); image.dataset.k = 'image';
      const alt = txt(p.alt, 'Image alt text'); alt.dataset.k = 'alt';
      const link = txt(p.link, 'Link or #'); link.dataset.k = 'link';
      const tech = txt(arr(p.tech).join(', '), 'Tech, comma separated'); tech.dataset.k = 'tech';
      const desc = area(p.desc, 'One or two sentences'); desc.dataset.k = 'desc';
      grid.appendChild(fld('Tag', tag));
      grid.appendChild(fld('Project name', name));
      grid.appendChild(fld('Image path', image));
      grid.appendChild(fld('Image alt text', alt));
      grid.appendChild(fld('Link', link));
      grid.appendChild(fld('Tech (comma separated)', tech));
      grid.appendChild(fld('Description', desc, true));
      card.appendChild(grid);
      return card;
    }
    function readWorkCard(card) {
      const g = (k) => {
        const el = card.querySelector('[data-k="' + k + '"]');
        return el ? el.value.trim() : '';
      };
      return {
        tag: g('tag'), name: g('name'), desc: g('desc'),
        tech: g('tech').split(',').map((s) => s.trim()).filter(Boolean),
        image: g('image'), alt: g('alt'), link: g('link') || '#'
      };
    }
    function makePlanCard(it) {
      const p = it || {};
      const card = cardShell('Plan');
      const grid = document.createElement('div');
      grid.className = 'form-grid';
      const name = txt(p.name, 'e.g. Business'); name.dataset.k = 'name';
      const flag = txt(p.flag, 'Badge e.g. Most Popular (blank = none)'); flag.dataset.k = 'flag';
      const cta = txt(p.cta, 'e.g. Get a Quote'); cta.dataset.k = 'cta';
      const link = txt(p.link, 'e.g. #contact'); link.dataset.k = 'link';
      const style = document.createElement('select'); style.dataset.k = 'cta_style';
      ['solid', 'outline'].forEach((s) => {
        const o = document.createElement('option');
        o.value = s; o.textContent = s === 'solid' ? 'Solid button' : 'Outline button';
        if ((p.cta_style || 'solid') === s) o.selected = true;
        style.appendChild(o);
      });
      const featWrap = document.createElement('label');
      featWrap.className = 'checkbox-row';
      const feat = document.createElement('input');
      feat.type = 'checkbox'; feat.dataset.k = 'featured';
      feat.checked = !!p.featured;
      featWrap.appendChild(feat);
      featWrap.appendChild(document.createTextNode(' Featured card (highlighted)'));
      const desc = area(p.desc, 'One line under the plan name'); desc.dataset.k = 'desc';
      const feats = area(arr(p.features).join('\n'), 'One feature per line'); feats.dataset.k = 'features';
      feats.rows = 5;
      grid.appendChild(fld('Plan name', name));
      grid.appendChild(fld('Badge', flag));
      grid.appendChild(fld('Button label', cta));
      grid.appendChild(fld('Button link', link));
      grid.appendChild(fld('Button style', style));
      const fw = document.createElement('div');
      fw.className = 'field';
      fw.appendChild(featWrap);
      grid.appendChild(fw);
      grid.appendChild(fld('Tagline', desc, true));
      grid.appendChild(fld('Features (one per line)', feats, true));
      card.appendChild(grid);
      return card;
    }
    function readPlanCard(card) {
      const g = (k) => {
        const el = card.querySelector('[data-k="' + k + '"]');
        return el ? el.value.trim() : '';
      };
      const feat = card.querySelector('[data-k="featured"]');
      return {
        name: g('name'), flag: g('flag'), desc: g('desc'),
        features: g('features').split('\n').map((s) => s.trim()).filter(Boolean),
        cta: g('cta') || 'Get a Quote', link: g('link') || '#contact',
        cta_style: g('cta_style') || 'solid', featured: !!(feat && feat.checked)
      };
    }
    const CARD_DEFS = {
      'work.items': { make: makeWorkCard, read: readWorkCard, blank: {} },
      'pricing.plans': { make: makePlanCard, read: readPlanCard, blank: {} }
    };
    function renderCards() {
      Object.keys(CARD_DEFS).forEach((key) => {
        const box = $('[data-cards="' + key + '"]');
        if (!box) return;
        const data = getPath(content, key);
        box.innerHTML = '';
        (Array.isArray(data) ? data : []).forEach((it) => box.appendChild(CARD_DEFS[key].make(it)));
      });
      renumberCards();
    }
    function readCards(key) {
      const box = $('[data-cards="' + key + '"]');
      if (!box || !CARD_DEFS[key]) return [];
      const out = [];
      $$('.card-editor', box).forEach((card) => {
        const v = CARD_DEFS[key].read(card);
        if (v.name) out.push(v); // unnamed cards are drafts — skip
      });
      return out;
    }

    /* ---------- form binding ---------- */
    function hydrateForms() {
      $$('[data-path]').forEach((inp) => {
        const v = getPath(content, inp.dataset.path);
        if (inp.type === 'checkbox') inp.checked = !!v;
        else inp.value = v == null ? '' : v;
      });
      Object.keys(LIST_DEFS).forEach(renderList);
      renderCards();
    }
    function collectForm(scope) {
      $$('[data-path]', scope).forEach((inp) => {
        setPath(content, inp.dataset.path, inp.type === 'checkbox' ? inp.checked : inp.value);
      });
      $$('[data-list]', scope).forEach((listEl) => {
        if (!LIST_DEFS[listEl.dataset.list]) return;
        setPath(content, listEl.dataset.list, readList(listEl.dataset.list));
      });
      $$('[data-cards]', scope).forEach((box) => {
        if (!CARD_DEFS[box.dataset.cards]) return;
        setPath(content, box.dataset.cards, readCards(box.dataset.cards));
      });
    }
    async function putContent(btn) {
      const orig = btn ? btn.innerHTML : '';
      if (btn) { btn.disabled = true; btn.innerHTML = 'Saving…'; }
      try {
        await window.site.api.put('/admin/content', { content });
        toast('Saved — changes are live on the website.');
        refreshOverview();
      } catch (e) { toast('Save failed: ' + e.message, 'err'); }
      finally { if (btn) { btn.disabled = false; btn.innerHTML = orig; } }
    }
    function saveContent(formEl) {
      collectForm(formEl);
      putContent(formEl.querySelector('button[type="submit"]'));
    }
    function saveAll() {
      $$('form[data-content-form]').forEach(collectForm);
      putContent($('#saveAllBtn'));
    }

    /* ---------- messages ---------- */
    async function loadMessages() {
      const filter = $('#msgFilter') ? $('#msgFilter').value : 'all';
      const res = await window.site.api.get('/admin/messages?status=' + encodeURIComponent(filter));
      messages = res.messages || [];
      renderMessages();
    }
    function renderMessages() {
      const wrap = $('#msgList');
      if (!wrap) return;
      wrap.innerHTML = '';
      if (!messages.length) {
        wrap.innerHTML = '<p class="empty-note">No messages here yet.</p>';
        return;
      }
      messages.forEach((m) => {
        const card = document.createElement('article');
        card.className = 'msg-card' + (m.status === 'new' ? ' is-new' : '');
        const head = document.createElement('div');
        head.className = 'msg-head';
        const who = document.createElement('div');
        const nm = document.createElement('strong');
        nm.textContent = m.name || '—';
        const em = document.createElement('a');
        em.href = 'mailto:' + (m.email || '');
        em.textContent = m.email || '';
        who.appendChild(nm);
        who.appendChild(document.createElement('br'));
        who.appendChild(em);
        if (m.company) {
          const co = document.createElement('span');
          co.className = 'msg-co';
          co.textContent = ' · ' + m.company;
          who.appendChild(co);
        }
        const meta = document.createElement('div');
        meta.className = 'msg-meta';
        const pill = document.createElement('span');
        pill.className = 'status-pill ' + esc(m.status || 'new');
        pill.textContent = m.status || 'new';
        const when = document.createElement('span');
        when.className = 'msg-time';
        when.textContent = timeAgo(m.created_at);
        when.title = m.created_at || '';
        meta.appendChild(pill);
        meta.appendChild(when);
        head.appendChild(who);
        head.appendChild(meta);
        const body = document.createElement('p');
        body.className = 'msg-body';
        body.textContent = m.message || '';
        const acts = document.createElement('div');
        acts.className = 'msg-actions';
        const btns = [];
        if (m.status === 'new') btns.push(['read', 'Mark read', '']);
        if (m.status !== 'archived') btns.push(['archived', 'Archive', '']);
        else btns.push(['read', 'Unarchive', '']);
        btns.push(['delete', 'Delete', 'danger']);
        btns.forEach(([act, label, cls]) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'btn btn-sm' + (cls ? ' ' + cls : '');
          b.textContent = label;
          b.dataset.act = act;
          b.dataset.id = m.id;
          acts.appendChild(b);
        });
        card.appendChild(head);
        card.appendChild(body);
        card.appendChild(acts);
        wrap.appendChild(card);
      });
    }
    function initMessages() {
      const wrap = $('#msgList');
      if (wrap) wrap.addEventListener('click', async (e) => {
        const b = e.target.closest('button[data-act]');
        if (!b) return;
        const id = b.dataset.id;
        const act = b.dataset.act;
        if (act === 'delete' && !confirm('Delete this message?')) return;
        b.disabled = true;
        try {
          if (act === 'delete') {
            await window.site.api.del('/admin/messages/' + id);
            toast('Message deleted.');
          } else {
            await window.site.api.put('/admin/messages/' + id, { status: act });
            toast(act === 'archived' ? 'Archived.' : 'Marked as read.');
          }
          await loadMessages();
          refreshOverview();
        } catch (err2) { toast(err2.message, 'err'); b.disabled = false; }
      });
      const f = $('#msgFilter');
      if (f) f.addEventListener('change', () => loadMessages().catch((e) => toast(e.message, 'err')));
      const r = $('#msgReload');
      if (r) r.addEventListener('click', () => loadMessages().catch((e) => toast(e.message, 'err')));
    }

    /* ---------- admins ---------- */
    async function loadAdmins() {
      const res = await window.site.api.get('/admin/admins');
      renderAdmins(res.admins || []);
    }
    function renderAdmins(admins) {
      const wrap = $('#adminList');
      if (!wrap) return;
      wrap.innerHTML = '';
      admins.forEach((a) => {
        const row = document.createElement('div');
        row.className = 'admin-row';
        row.dataset.id = a.id;
        const email = document.createElement('input');
        email.type = 'email'; email.value = a.email || '';
        email.className = 'a-email';
        email.setAttribute('aria-label', 'Email');
        const pw = document.createElement('input');
        pw.type = 'password'; pw.placeholder = 'New password (blank = keep)';
        pw.className = 'a-pw';
        pw.setAttribute('aria-label', 'New password');
        pw.autocomplete = 'new-password';
        const actWrap = document.createElement('label');
        actWrap.className = 'checkbox-row inline';
        const act = document.createElement('input');
        act.type = 'checkbox'; act.className = 'a-active';
        act.checked = a.active !== 0;
        actWrap.appendChild(act);
        actWrap.appendChild(document.createTextNode(' Active'));
        const save = document.createElement('button');
        save.type = 'button'; save.className = 'btn btn-sm';
        save.textContent = 'Save'; save.dataset.act = 'save';
        const del = document.createElement('button');
        del.type = 'button'; del.className = 'btn btn-sm danger';
        del.textContent = 'Delete'; del.dataset.act = 'del';
        if (currentUser && a.id === currentUser.id) {
          del.disabled = true; del.title = 'You cannot delete your own account';
          act.disabled = true; act.title = 'You cannot deactivate your own account';
        }
        row.appendChild(email);
        row.appendChild(pw);
        row.appendChild(actWrap);
        row.appendChild(save);
        row.appendChild(del);
        wrap.appendChild(row);
      });
      if (!admins.length) wrap.innerHTML = '<p class="empty-note">No admins found.</p>';
    }
    function initAdmins() {
      const wrap = $('#adminList');
      if (wrap) wrap.addEventListener('click', async (e) => {
        const b = e.target.closest('button[data-act]');
        if (!b) return;
        const row = b.closest('.admin-row');
        const id = row.dataset.id;
        b.disabled = true;
        try {
          if (b.dataset.act === 'del') {
            if (!confirm('Delete this admin?')) { b.disabled = false; return; }
            await window.site.api.del('/admin/admins/' + id);
            toast('Admin deleted.');
          } else {
            const payload = {
              email: $('.a-email', row).value.trim(),
              active: $('.a-active', row).checked
            };
            const pw = $('.a-pw', row).value;
            if (pw) payload.password = pw;
            await window.site.api.put('/admin/admins/' + id, payload);
            toast('Admin updated.');
          }
          await loadAdmins();
        } catch (err2) { toast(err2.message, 'err'); b.disabled = false; }
      });
      const f = $('#addAdminForm');
      if (f) f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const status = $('#addAdminStatus');
        status.className = 'form-status';
        status.textContent = '';
        try {
          await window.site.api.post('/admin/admins', {
            email: $('#newAdminEmail').value.trim(),
            password: $('#newAdminPw').value
          });
          status.className = 'form-status ok';
          status.textContent = 'Admin added.';
          f.reset();
          await loadAdmins();
          refreshOverview();
        } catch (err2) { status.className = 'form-status err'; status.textContent = err2.message; }
      });
    }

    /* ---------- password ---------- */
    function initPasswordForm() {
      const f = $('#formPassword');
      if (!f) return;
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const status = $('#pwStatus');
        const btn = f.querySelector('button[type="submit"]');
        const cur = $('#curPw').value;
        const next = $('#newPw').value;
        const confirm = $('#newPw2').value;
        status.className = 'form-status';
        status.textContent = '';
        if (next !== confirm) {
          status.className = 'form-status err';
          status.textContent = 'New passwords do not match.';
          return;
        }
        if (next.length < 10) {
          status.className = 'form-status err';
          status.textContent = 'New password must be at least 10 characters.';
          return;
        }
        btn.disabled = true;
        const orig = btn.innerHTML;
        btn.innerHTML = 'Updating…';
        try {
          await window.site.api.post('/admin/password', { current_password: cur, new_password: next });
          status.className = 'form-status ok';
          status.textContent = 'Password updated. Other sessions were signed out.';
          f.reset();
        } catch (err2) { status.className = 'form-status err'; status.textContent = err2.message; }
        finally { btn.disabled = false; btn.innerHTML = orig; }
      });
    }

    /* ---------- overview / tabs / demo ---------- */
    async function refreshOverview() {
      try {
        const s = await window.site.api.get('/admin/stats');
        $('#statMessages').textContent = s.new_messages != null ? s.new_messages : '–';
        $('#statProjects').textContent = s.projects != null ? s.projects : '–';
        $('#statAdmins').textContent = s.admins != null ? s.admins : '–';
        const u = $('#statUpdated');
        u.textContent = s.content_updated_at ? timeAgo(s.content_updated_at) : 'never';
        const badge = $('#msgBadge');
        if (badge) {
          const n = s.new_messages || 0;
          badge.textContent = n > 99 ? '99+' : String(n);
          badge.classList.toggle('hidden', n === 0);
        }
      } catch (e) { /* best-effort */ }
    }
    function initTabs() {
      $$('#sideNav button').forEach((btn) => btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        $$('#sideNav button').forEach((b) => b.classList.toggle('active', b === btn));
        $$('.tab-pane').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + tab));
        if (tab === 'messages') loadMessages().catch((e) => toast('Could not load messages: ' + e.message, 'err'));
        if (tab === 'admins') loadAdmins().catch((e) => toast('Could not load admins: ' + e.message, 'err'));
        if (tab === 'overview') refreshOverview();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }));
    }
    function loadDemo() {
      if (!confirm('Load demo content? This fills every editor field with the sample site content. Nothing is published until you click “Save changes”.')) return;
      content = clone(window.SITE_DEFAULTS);
      hydrateForms();
      toast('Demo loaded — review each tab and click “Save changes” to publish.');
    }
    function initDemo() {
      const d = $('#demoBtn');
      if (d) d.addEventListener('click', loadDemo);
      const s = $('#saveAllBtn');
      if (s) s.addEventListener('click', saveAll);
      const r = $('#overviewReload');
      if (r) r.addEventListener('click', refreshOverview);
    }

    async function initDashboard(user) {
      currentUser = user; // caller already verified the session — no redirects here
      $('#userEmail').textContent = (currentUser && currentUser.email) || '';
      $('#logoutBtn').addEventListener('click', async () => {
        try { await window.site.api.post('/auth/logout', {}); } catch (x) { /* ignore */ }
        window.location.reload();
      });
      try {
        const res = await window.site.api.get('/admin/content');
        content = (res && res.content) ? res.content : {};
      } catch (e) { toast('Could not load content: ' + e.message, 'err'); content = {}; }
      LIST_DEFS = buildListDefs();
      hydrateForms();
      $$('form[data-content-form]').forEach((f) => {
        f.addEventListener('submit', (e) => { e.preventDefault(); saveContent(f); });
      });
      $$('.add-row-btn').forEach((btn) => btn.addEventListener('click', () => {
        const def = LIST_DEFS[btn.dataset.add];
        if (def && def.container) {
          def.container.appendChild(makeListRow(def, {})); // blank row; read-time defaults apply on save
          def.container.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }));
      const aw = $('#addWorkBtn');
      if (aw) aw.addEventListener('click', () => {
        const box = $('[data-cards="work.items"]');
        box.appendChild(makeWorkCard({}));
        renumberCards();
        box.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      const ap = $('#addPlanBtn');
      if (ap) ap.addEventListener('click', () => {
        const box = $('[data-cards="pricing.plans"]');
        box.appendChild(makePlanCard({ cta_style: 'solid' }));
        renumberCards();
        box.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      initMessages();
      initAdmins();
      initDemo();
      initPasswordForm();
      initTabs();
      refreshOverview();
    }

    /* ---------- login / setup views ---------- */
    function showView(name) {
      $('#authWrap').classList.toggle('hidden', name === 'dash');
      $('#view-login').classList.toggle('hidden', name !== 'login');
      $('#view-setup').classList.toggle('hidden', name !== 'setup');
      $('#view-dash').classList.toggle('hidden', name !== 'dash');
    }
    function initLogin() {
      window.site.api.get('/auth/me')
        .then((me) => { showView('dash'); initDashboard(me.user); })
        .catch(() => showView('login'));

      $('#loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const errBox = $('#loginError');
        errBox.classList.remove('show');
        const btn = $('#loginBtn');
        btn.disabled = true;
        const orig = btn.innerHTML;
        btn.innerHTML = 'Signing in…';
        try {
          const res = await window.site.api.post('/auth/login', {
            email: $('#loginEmail').value.trim(),
            password: $('#loginPassword').value
          });
          $('#loginPassword').value = '';
          showView('dash');
          initDashboard(res.user);
        } catch (err2) {
          errBox.textContent = err2.message || 'Login failed.';
          errBox.classList.add('show');
          btn.disabled = false;
          btn.innerHTML = orig;
        }
      });
      $('#goSetup').addEventListener('click', (e) => {
        e.preventDefault();
        const sf = $('#setupForm'); // reset in case setup already ran once
        if (sf) sf.style.display = '';
        $('#setupOk').classList.remove('show');
        showView('setup');
      });
      $('#backLogin').addEventListener('click', (e) => { e.preventDefault(); showView('login'); });

      $('#setupForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const errBox = $('#setupError');
        const okBox = $('#setupOk');
        errBox.classList.remove('show');
        errBox.textContent = '';
        okBox.classList.remove('show');
        const btn = $('#setupBtn');
        const password = $('#setupPassword').value;
        if (password.length < 10) {
          errBox.textContent = 'Password must be at least 10 characters.';
          errBox.classList.add('show');
          return;
        }
        btn.disabled = true;
        const orig = btn.innerHTML;
        btn.innerHTML = 'Creating…';
        try {
          await window.site.api.post('/auth/setup', {
            setup_key: $('#setupKey').value,
            email: $('#setupEmail').value.trim(),
            password
          });
          okBox.classList.add('show');
          $('#setupForm').style.display = 'none';
          setTimeout(() => { showView('login'); }, 1500);
        } catch (err2) {
          errBox.textContent = err2.status === 404 ? 'Setup is disabled — no SETUP_SECRET configured.'
            : err2.status === 403 ? 'Incorrect setup secret.' : (err2.message || 'Setup failed.');
          errBox.classList.add('show');
          btn.disabled = false;
          btn.innerHTML = orig;
        }
      });
    }
    function init() {
      if ($('#loginForm')) initLogin(); // login view always ships in admin.html
    }
    return { init };
  })();

  /* ----------------------------------------------------------------------
     BOOT
  ---------------------------------------------------------------------- */
  if (document.body.classList.contains('admin')) Admin.init();
  else if (document.body.classList.contains('landing')) Landing.init();
})();
