"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Language = "en" | "roman_urdu" | "urdu";

// Translation dictionary — English (default) + Roman Urdu
// Urdu RTL needs a separate font + direction handling (stubbed)
type Dict = Record<string, { en: string; roman_urdu: string; urdu: string }>;

const dict: Dict = {
  // Nav
  "nav.fundamental_news": { en: "Fundamental News", roman_urdu: "Bunyadi Khabrein", urdu: "بنیادی خبریں" },
  "nav.technical_analysis": { en: "Technical Analysis", roman_urdu: "Technical Tajzea", urdu: "تکنیکی تجزیہ" },
  "nav.signals": { en: "Signals", roman_urdu: "Signals", urdu: "اشارات" },
  "nav.portfolio": { en: "Portfolio", roman_urdu: "Portfolio", urdu: "پورٹفولیو" },
  "nav.strategy": { en: "Strategy", roman_urdu: "Strategy", urdu: "حکمتِ عمل" },
  "nav.dividends": { en: "Dividends", roman_urdu: "Dividends", urdu: "ڈیویڈنڈ" },
  "nav.tracker": { en: "Tracker", roman_urdu: "Tracker", urdu: "ٹریکر" },
  "nav.ai_model_signals": { en: "AI Models", roman_urdu: "AI Models", urdu: "اے آئی ماڈلز" },
  "nav.calculators": { en: "Calculators", roman_urdu: "Calculators", urdu: "کیلکولیٹرز" },
  "nav.pattern_finder": { en: "Pattern Finder", roman_urdu: "Pattern Finder", urdu: "پیٹرن فائنڈر" },

  // Common
  "common.loading": { en: "Loading...", roman_urdu: "Lodaing ho raha hai...", urdu: "لوڈ ہو رہا ہے..." },
  "common.error": { en: "Something went wrong", roman_urdu: "Kuch masla ho gaya", urdu: "کوئی مسئلہ ہو گیا" },
  "common.view_detail": { en: "View detail", roman_urdu: "Tafseel dekhein", urdu: "تفصیل دیکھیں" },
  "common.execute": { en: "Execute", roman_urdu: "Execute", urdu: "ایکزیکیوٹ" },
  "common.back": { en: "Back", roman_urdu: "Wapas", urdu: "واپس" },
  "common.refresh": { en: "Refresh", roman_urdu: "Refresh", urdu: "ریفریش" },
  "common.all": { en: "All", roman_urdu: "Sab", urdu: "سب" },
  "common.search": { en: "Search", roman_urdu: "Search", urdu: "تلاش" },

  // Signal
  "signal.buy": { en: "BUY", roman_urdu: "KHAREEDAIN", urdu: "خریدیں" },
  "signal.sell": { en: "SELL", roman_urdu: "BECHEIN", urdu: "بیچیں" },
  "signal.hold": { en: "HOLD", roman_urdu: "HOLD", urdu: "ہولڈ" },
  "signal.accumulate": { en: "ACCUMULATE", roman_urdu: "JAMA KAREin", urdu: "جمع کریں" },
  "signal.confidence": { en: "Confidence", roman_urdu: "Confidence", urdu: "اعتماد" },

  // News
  "news.international_national": { en: "International & National", roman_urdu: "International aur National", urdu: "بین الاقوامی و قومی" },
  "news.company_news": { en: "Company News", roman_urdu: "Company Khabrein", urdu: "کمپنی خبریں" },
  "news.company_results": { en: "Company Results", roman_urdu: "Company Natijay", urdu: "کمپنی نتائج" },
  "news.remarks": { en: "Remarks", roman_urdu: "Tabsara", urdu: "تبصرہ" },
  "news.impact": { en: "Impact", roman_urdu: "Asar", urdu: "اثر" },
  "news.affected_stocks": { en: "Affected stocks", roman_urdu: "Mutruisht stocks", urdu: "متاثرہ اسٹاکس" },
  "news.open_signal": { en: "Open signal", roman_urdu: "Signal kholain", urdu: "اشارہ کھولیں" },
  "news.view_pdf": { en: "View PDF", roman_urdu: "PDF dekhein", urdu: "پی ڈی ایف دیکھیں" },
  "news.interpret_link": { en: "Interpret a news link", roman_urdu: "News link interpret karein", urdu: "نیوز لنک کی تشریح کریں" },
  "news.paste_link": { en: "Paste any news article URL to get an AI interpretation", roman_urdu: "AI interpretation ke luye koi bhi news article URL paste karein", urdu: "اے آئی تشریح کے لیے کوئی بھی نیوز آرٹیکل یو آر ایل پیسٹ کریں" },

  // Portfolio
  "portfolio.add_stock": { en: "Add stock", roman_urdu: "Stock add karein", urdu: "اسٹاک شامل کریں" },
  "portfolio.empty": { en: "No stocks in your portfolio yet", roman_urdu: "Aap ke portfolio mein abhi koi stock nahi", urdu: "آپ کے پورٹفولیو میں ابھی کوئی اسٹاک نہیں" },
  "portfolio.hold": { en: "Hold", roman_urdu: "Hold", urdu: "ہولڈ" },
  "portfolio.sell": { en: "Sell", roman_urdu: "Sell", urdu: "بیچیں" },
  "portfolio.buy_more": { en: "Buy more to average", roman_urdu: "Average ke luye aur khareedain", urdu: "اوسط کے لیے مزید خریدیں" },
  "portfolio.profit": { en: "Profit", roman_urdu: "Profit", urdu: "منافع" },
  "portfolio.loss": { en: "Loss", roman_urdu: "Loss", urdu: "نقصان" },

  // Strategy
  "strategy.goal_question": { en: "What's your investment goal?", roman_urdu: "Aap ki investment maqsad kya hai?", urdu: "آپ کی انویسٹمنٹ مقصد کیا ہے؟" },

  // Tracker
  "tracker.signal_tracker": { en: "Signal Tracker", roman_urdu: "Signal Tracker", urdu: "سگنل ٹریکر" },
  "tracker.portfolio_tracker": { en: "Portfolio Tracker", roman_urdu: "Portfolio Tracker", urdu: "پورٹفولیو ٹریکر" },
  "tracker.win_rate": { en: "Win rate", roman_urdu: "Win rate", urdu: "کامیابی کی شرح" },
  "tracker.roi": { en: "ROI %", roman_urdu: "ROI %", urdu: "آر او آئی %" },

  // Landing
  "landing.cta.build_plan": { en: "Build my plan", roman_urdu: "Apna plan banayein", urdu: "اپنا پلان بنائیں" },
  "landing.cta.explore": { en: "Explore the platform", roman_urdu: "Platform explore karein", urdu: "پلیٹ فارم ایکسپلور کریں" },
};

interface I18nState {
  lang: Language;
  setLang: (l: Language) => void;
  t: (key: string) => string;
}

export const useI18n = create<I18nState>()(
  persist(
    (set, get) => ({
      lang: "en",
      setLang: (l) => set({ lang: l }),
      t: (key: string) => {
        const entry = dict[key];
        if (!entry) return key;
        const lang = get().lang;
        return entry[lang] || entry.en;
      },
    }),
    { name: "latent-i18n" }
  )
);

// Direction helper for RTL
export function getDirection(lang: Language): "ltr" | "rtl" {
  return lang === "urdu" ? "rtl" : "ltr";
}
