"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";

import { signOutSafely } from "@/lib/push/client";

import { Eye, EyeOff, Heart, KeyRound, Link2, LogIn, RefreshCw, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { getSupabaseBrowser, isSupabaseConfigured } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/errors";

export default function LoginPage() {
  const { t: uiText } = useLanguage();

  const configured = isSupabaseConfigured();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState("");
  const [setup, setSetup] = useState(false);
  const [code, setCode] = useState("");
  const [anniversary, setAnniversary] = useState("");
  const [myCode, setMyCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword,setShowPassword]=useState(false);

  async function loadPairState() {
    const s = getSupabaseBrowser();
    if (!s) return;
    const { data: auth } = await s.auth.getSession();
    const user = auth.session?.user;
    if (!user) { setSetup(false); return; }
    const { data: pair } = await s.from("couples").select("id,user_a,user_b,invite_code,anniversary_date").or(`user_a.eq.${user.id},user_b.eq.${user.id}`).maybeSingle();
    if (!pair) { setSetup(true); setMyCode(""); return; }
    if (pair.user_a && pair.user_b) { window.location.href = "/home"; return; }
    setSetup(true);
    setMyCode(pair.invite_code || "");
    setAnniversary(pair.anniversary_date || "");
  }

  useEffect(() => {
    if (!configured) return;
    void loadPairState();
    const timer = window.setInterval(() => { if (setup && myCode) void loadPairState(); }, 3500);
    return () => window.clearInterval(timer);
  }, [configured, setup, myCode]);

  async function auth() {
    const s = getSupabaseBrowser(); if (!s || busy) return;
    setBusy(true); setStatus("");
    try {
      if (mode === "signup") {
        if (!name.trim()) throw new Error("Enter your real display name.");
        const { data, error } = await s.auth.signUp({ email: email.trim(), password, options: { data: { display_name: name.trim() } } });
        if (error) throw error;
        if (!data.session) { setStatus("Account created. Check your email to confirm the account, then sign in."); setMode("login"); return; }
        setSetup(true);
        await loadPairState();
      } else {
        const { error } = await s.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        await loadPairState();
      }
    } catch (error: unknown) { setStatus(errorMessage(error, "Could not continue.")); }
    finally { setBusy(false); }
  }

  async function createPair() {
    const s = getSupabaseBrowser(); if (!s || busy) return;
    setBusy(true); setStatus("");
    try {
      const user = (await s.auth.getUser()).data.user; if (!user) throw new Error("Sign in first.");
      const { data: existing } = await s.from("couples").select("invite_code,user_b,anniversary_date").or(`user_a.eq.${user.id},user_b.eq.${user.id}`).maybeSingle();
      if (existing) {
        if (existing.user_b) { window.location.href = "/home"; return; }
        setMyCode(existing.invite_code); setAnniversary(existing.anniversary_date || ""); return;
      }
      const c = Array.from(crypto.getRandomValues(new Uint8Array(8))).map(n => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[n % 32]).join("");
      const { data, error } = await s.from("couples").insert({ user_a: user.id, invite_code: c, anniversary_date: anniversary || null }).select("invite_code").single();
      if (error) throw error;
      setMyCode(data.invite_code);
      setStatus("Private pair created. Give this code only to your partner.");
    } catch (error: unknown) { setStatus(errorMessage(error, "Could not create the pair.")); }
    finally { setBusy(false); }
  }

  async function joinPair() {
    const s = getSupabaseBrowser(); if (!s || busy) return;
    setBusy(true); setStatus("");
    try {
      if (!code.trim()) throw new Error("Enter the Pair Code.");
      const { error } = await s.rpc("join_couple", { p_code: code.trim().toUpperCase() });
      if (error) throw error;
      window.location.href = "/home";
    } catch (error: unknown) { setStatus(errorMessage(error, "Could not join the pair.")); }
    finally { setBusy(false); }
  }

  async function signOut() {
    try{await signOutSafely();setSetup(false);setMyCode("");setStatus("");}
    catch(error:unknown){setStatus(errorMessage(error,"Could not safely sign out. Try again."));}
  }

  if (!configured) return <main className="login-shell"><section className="login-card"><LanguageSwitcher compact/>
    <div className="login-brand"><Heart fill="currentColor" color="var(--rose)" style={{ margin: "auto" }}/><h1>{uiText("Together")}</h1><div className="brand-sub">{uiText("REAL USE SETUP")}</div></div>
    <div className="notice error"><strong>{uiText("Backend is not connected yet.")}</strong><br/>{uiText("The fake/demo data has been removed. To use the app for real on two phones, connect one Supabase project using ")}<code>{uiText(".env.local")}</code>.</div>
    <div className="card glass" style={{ marginTop: 14 }}><h2 className="mini-title">{uiText("Required once")}</h2><ol className="setup-list"><li>{uiText("Create a Supabase project.")}</li><li>{uiText("Run migrations 001–007 in order in its SQL Editor.")}</li><li>{uiText("Add the project URL and anon key to ")}<code>{uiText(".env.local")}</code>{uiText(", then restart the app.")}</li></ol></div>
    <p className="hint" style={{ marginTop: 12 }}>{uiText("No personal messages, photos, dates, or relationship details are preloaded anymore.")}</p>
  </section></main>;

  if (setup) return <main className="login-shell"><section className="login-card"><LanguageSwitcher compact/>
    <div className="login-brand"><Heart fill="currentColor" color="var(--rose)" style={{ margin: "auto" }}/><h1>{uiText("Together")}</h1><div className="brand-sub">{uiText("YOUR SPACE STARTS WITH TWO")}</div></div>
    {status && <div className="notice">{uiText(status)}</div>}
    <div className="card glass" style={{ marginTop: 12 }}>
      <h2 className="mini-title">{uiText("Create our private pair")}</h2>
      <label className="field-label">{uiText("Relationship start date (optional)")}</label>
      <input className="input" type="date" value={anniversary} onChange={e => setAnniversary(e.target.value)} disabled={Boolean(myCode)}/>
      {!myCode ? <button className="soft-btn" style={{ width: "100%", marginTop: 9 }} onClick={createPair} disabled={busy}><KeyRound size={17} style={{ display: "inline", marginRight: 6 }}/>{uiText("Create Pair Code")}</button> : <>
        <div className="success" style={{ padding: 13, borderRadius: 16, marginTop: 10, textAlign: "center" }}><div className="hint">{uiText("Share this code only with your partner")}</div><strong style={{ fontSize: 28, letterSpacing: 4 }}>{myCode}</strong></div>
        <button className="soft-btn secondary" style={{ width: "100%", marginTop: 9 }} onClick={loadPairState}><RefreshCw size={16} style={{ display: "inline", marginRight: 6 }}/>{uiText("Check if partner joined")}</button>
      </>}
    </div>
    {!myCode && <><div style={{ textAlign: "center", margin: "13px", color: "var(--muted)" }}>{uiText("or")}</div><div className="card glass"><h2 className="mini-title">{uiText("Join my partner")}</h2><input className="input" value={code} maxLength={8} onChange={e => setCode(e.target.value.toUpperCase())} placeholder={uiText("PAIR CODE")} aria-label={uiText("Your partner’s Pair Code")}/><button className="soft-btn" style={{ width: "100%", marginTop: 9 }} onClick={joinPair} disabled={busy}><Link2 size={17} style={{ display: "inline", marginRight: 6 }}/>{uiText("Join Pair")}</button></div></>}
    <button className="text-button" onClick={signOut}>{uiText("Sign out")}</button>
  </section></main>;

  return <main className="login-shell"><section className="login-card"><LanguageSwitcher compact/>
    <div className="login-brand"><Heart fill="currentColor" color="var(--rose)" style={{ margin: "auto" }}/><h1>{uiText("Together")}</h1><div className="brand-sub">{uiText("A LITTLE CLOSER, EVERY DAY")}</div></div>
    {status && <div className="notice">{uiText(status)}</div>}
    <form className="form-stack" style={{ marginTop: 12 }} onSubmit={e=>{e.preventDefault();void auth();}}>
      {mode === "signup" && <label className="field-label">{uiText("Your name")}<input className="input" value={name} onChange={e => setName(e.target.value)} placeholder={uiText("What should we call you?")} autoComplete="name" required/></label>}
      <label className="field-label">{uiText("Email")}<input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={uiText("you@example.com")} autoComplete="email" required/></label>
      <label className="field-label">{uiText("Password")}<div className="password-field"><input className="input" type={showPassword?"text":"password"} value={password} onChange={e => setPassword(e.target.value)} placeholder={uiText("Your password")} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode==="signup"?6:undefined} required/><button type="button" aria-label={showPassword?uiText("Hide password"):uiText("Show password")} onClick={()=>setShowPassword(value=>!value)}>{showPassword?<EyeOff size={19}/>:<Eye size={19}/>}</button></div></label>
      <button className="soft-btn" type="submit" disabled={busy}>{busy?uiText("Please wait…"):mode === "login" ? <><LogIn size={17} style={{ display: "inline", marginRight: 6 }}/>{uiText("Sign in")}</> : <><UserPlus size={17} style={{ display: "inline", marginRight: 6 }}/>{uiText("Create account")}</>}</button>
      <button type="button" className="soft-btn secondary" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setStatus(""); }}>{mode === "login" ? uiText("Create one of the two accounts") : uiText("I already have an account")}</button>
    </form>
    <p className="hint" style={{ marginTop: 14 }}>{uiText("Just two accounts. Connect with a private Pair Code and make this space yours.")}</p>
  </section></main>;
}
