"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BrandMark } from "./BrandMark";
import { useLatentStore, LatentView } from "@/lib/latent/store";
import { useI18n, type Language } from "@/lib/latent/i18n";
import {
  Newspaper,
  BarChart3,
  Zap,
  Briefcase,
  Target,
  Coins,
  Activity,
  Bell,
  LogOut,
  Languages,
  Check,
  Brain,
  Calculator,
  Search,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

const NAV_ITEMS: { view: LatentView; key: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { view: "fundamental_news", key: "nav.fundamental_news", icon: Newspaper },
  { view: "technical_analysis", key: "nav.technical_analysis", icon: BarChart3 },
  { view: "signals_v2", key: "nav.signals", icon: Zap },
  { view: "ai_model_signals", key: "nav.ai_model_signals", icon: Brain },
  { view: "calculators", key: "nav.calculators", icon: Calculator },
  { view: "pattern_finder", key: "nav.pattern_finder", icon: Search },
  { view: "portfolio", key: "nav.portfolio", icon: Briefcase },
  { view: "strategy", key: "nav.strategy", icon: Target },
  { view: "dividends", key: "nav.dividends", icon: Coins },
  { view: "tracker", key: "nav.tracker", icon: Activity },
];

const LANG_OPTIONS: { value: Language; label: string; native: string }[] = [
  { value: "en", label: "English", native: "English" },
  { value: "roman_urdu", label: "Roman Urdu", native: "Roman Urdu" },
  { value: "urdu", label: "اردو", native: "اردو" },
];

export function AppNav() {
  const view = useLatentStore((s) => s.view);
  const setView = useLatentStore((s) => s.setView);
  const userName = useLatentStore((s) => s.userName);
  const userEmail = useLatentStore((s) => s.userEmail);
  const reset = useLatentStore((s) => s.reset);
  const notifications = useLatentStore((s) => s.notifications);
  const pushNotification = useLatentStore((s) => s.pushNotification);
  const markNotificationRead = useLatentStore((s) => s.markNotificationRead);
  const clearNotifications = useLatentStore((s) => s.clearNotifications);

  const t = useI18n((s) => s.t);
  const lang = useI18n((s) => s.lang);
  const setLang = useI18n((s) => s.setLang);

  const [notifOpen, setNotifOpen] = useState(false);
  const unread = notifications.filter((n) => !n.read).length;

  // In-app TP/SL polling — checks /api/cron/check-tp-sl every 5 minutes
  // while user is active in the app. Production should also run external cron
  // (Vercel Cron or GitHub Actions) to fire notifications when no users are online.
  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const checkTpSl = async () => {
      try {
        const res = await fetch("/api/cron/check-tp-sl");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;

        // Fire notifications for any TP/SL hits
        if (data.tpHits > 0 || data.slHits > 0) {
          for (const check of data.details || []) {
            for (const tp of check.tpHits || []) {
              pushNotification({
                type: "tp_hit",
                title: `🎯 TP HIT — ${tp.symbol}`,
                body: `Target ${tp.targetPrice} reached at ${tp.currentPrice}. Entry was ${tp.entryPrice}. Profit booked!`,
                linkView: "tracker",
              });
            }
            for (const sl of check.slHits || []) {
              pushNotification({
                type: "sl_hit",
                title: `🛑 SL HIT — ${sl.symbol}`,
                body: `Stop-loss ${sl.stopLoss} triggered at ${sl.currentPrice}. Entry was ${sl.entryPrice}. Loss realized.`,
                linkView: "tracker",
              });
            }
          }
        }
      } catch (err) {
        // Silent failure — don't spam user with errors
        console.warn("[AppNav] TP/SL check failed:", err);
      }
    };

    // Initial check after 30s (let app settle), then every 5 min
    const initialTimer = setTimeout(checkTpSl, 30000);
    intervalId = setInterval(checkTpSl, 5 * 60 * 1000);

    return () => {
      cancelled = true;
      clearTimeout(initialTimer);
      if (intervalId) clearInterval(intervalId);
    };
  }, [pushNotification]);

  const handleSignOut = () => {
    reset();
    setView("landing");
  };

  const handleNotifClick = (id: string, linkView?: LatentView) => {
    markNotificationRead(id);
    if (linkView) setView(linkView);
    setNotifOpen(false);
  };

  return (
    <header className="sticky top-0 z-50 bg-[#0A0E1A]/95 backdrop-blur-md border-b border-white/[0.06]">
      <div className="flex items-center justify-between gap-2 px-3 md:px-6 h-14 min-w-0">
        <div className="flex items-center gap-2 md:gap-4 flex-1 min-w-0">
          <button onClick={() => setView("dashboard")} className="hover:opacity-80 shrink-0">
            <BrandMark size="sm" />
          </button>
          {/* Desktop nav: scrollable tab strip (single row, no wrap) */}
          <nav className="hidden lg:flex items-center gap-0.5 flex-nowrap overflow-x-auto latent-no-scrollbar flex-1 min-w-0 max-w-full scroll-smooth">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = view === item.view ||
                (view === "signal_detail" && item.view === "signals_v2") ||
                (view === "execute" && item.view === "signals_v2");
              return (
                <Button
                  key={item.view}
                  variant="ghost"
                  size="sm"
                  onClick={() => setView(item.view)}
                  className={`shrink-0 px-2 h-8 ${
                    active
                      ? "bg-[#00E676]/10 text-[#00E676] hover:bg-[#00E676]/15"
                      : "text-[#94A3B8] hover:text-[#F4F7FB] hover:bg-white/[0.04]"
                  } gap-1.5 text-[11px] xl:text-xs`}
                >
                  <Icon className="h-3 w-3 xl:h-3.5 xl:w-3.5 shrink-0" />
                  <span className="whitespace-nowrap">{t(item.key)}</span>
                </Button>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <Badge variant="outline" className="border-[#00E676]/30 bg-[#00E676]/10 text-[#00E676] text-[10px] font-mono hidden sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-[#00E676] animate-pulse mr-1.5" />
            PSX LIVE
          </Badge>

          {/* Language dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-[#94A3B8] hover:text-[#F4F7FB] gap-1.5"
              >
                <Languages className="h-3.5 w-3.5" />
                <span className="hidden sm:inline text-xs">{LANG_OPTIONS.find((l) => l.value === lang)?.label}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-[#131829] border-white/[0.12]">
              <DropdownMenuLabel className="text-[#64748B] text-xs">Select language</DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-white/[0.08]" />
              {LANG_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => {
                    setLang(opt.value);
                    toast.success(`Language: ${opt.label}`);
                  }}
                  className="text-[#F4F7FB] hover:bg-white/[0.05] cursor-pointer"
                >
                  <div className="flex items-center justify-between w-full">
                    <span>{opt.label}</span>
                    {lang === opt.value && <Check className="h-3.5 w-3.5 text-[#00E676]" />}
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Notifications */}
          <DropdownMenu open={notifOpen} onOpenChange={setNotifOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative text-[#94A3B8] hover:text-[#F4F7FB]"
              >
                <Bell className="h-4 w-4" />
                {unread > 0 && (
                  <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-[#FF5C5C] animate-pulse" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-[#131829] border-white/[0.12] w-80">
              <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
                <span className="text-xs font-semibold text-[#F4F7FB]">
                  Notifications {unread > 0 && `(${unread})`}
                </span>
                {notifications.length > 0 && (
                  <button
                    onClick={() => clearNotifications()}
                    className="text-[10px] text-[#64748B] hover:text-[#94A3B8]"
                  >
                    Clear all
                  </button>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="px-3 py-6 text-center">
                    <Bell className="h-6 w-6 text-[#64748B]/40 mx-auto mb-2" />
                    <p className="text-xs text-[#64748B]">No notifications yet</p>
                    <p className="text-[10px] text-[#64748B]/70 mt-1">
                      Signal fires + TP/SL hits will appear here
                    </p>
                  </div>
                ) : (
                  notifications.slice(0, 20).map((n) => (
                    <button
                      key={n.id}
                      onClick={() => handleNotifClick(n.id, n.linkView)}
                      className="w-full text-left px-3 py-2 border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors"
                    >
                      <div className="flex items-start gap-2">
                        <div
                          className={`mt-0.5 h-1.5 w-1.5 rounded-full flex-shrink-0 ${
                            n.read ? "bg-[#64748B]" : "bg-[#00E676]"
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold text-[#F4F7FB] truncate">
                            {n.title}
                          </div>
                          <div className="text-[11px] text-[#94A3B8] line-clamp-2 mt-0.5">
                            {n.body}
                          </div>
                          <div className="text-[10px] text-[#64748B] mt-1 font-mono">
                            {new Date(n.createdAt).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" })}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* User */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-[#94A3B8] hover:text-[#F4F7FB] gap-2"
              >
                <div className="h-7 w-7 rounded-full bg-[#00E676]/15 flex items-center justify-center text-[#00E676] font-mono font-bold text-xs">
                  {(userName || "D").charAt(0).toUpperCase()}
                </div>
                <span className="hidden md:inline text-xs">{userName || "Demo User"}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-[#131829] border-white/[0.12]">
              <DropdownMenuLabel className="text-[#64748B] text-xs">
                {userEmail || "demo@latent.pk"}
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-white/[0.08]" />
              <DropdownMenuItem
                onClick={handleSignOut}
                className="text-[#94A3B8] hover:text-[#FF5C5C] hover:bg-[#FF5C5C]/[0.07] cursor-pointer"
              >
                <LogOut className="h-3.5 w-3.5 mr-2" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Mobile horizontal tab strip — single row, horizontal scroll */}
      <nav className="lg:hidden flex items-center gap-0.5 flex-nowrap px-3 pb-2 overflow-x-auto latent-no-scrollbar scroll-smooth">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = view === item.view;
          return (
            <Button
              key={item.view}
              variant="ghost"
              size="sm"
              onClick={() => setView(item.view)}
              className={`shrink-0 px-2 h-8 ${active ? "bg-[#00E676]/10 text-[#00E676]" : "text-[#94A3B8]"} gap-1.5 text-[10px] sm:text-xs`}
            >
              <Icon className="h-3 w-3 shrink-0" />
              <span className="whitespace-nowrap">{t(item.key)}</span>
            </Button>
          );
        })}
      </nav>
    </header>
  );
}
