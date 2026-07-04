import React, { useState, useEffect } from "react";
import {
  isConnected,
  getAddress,
  requestAccess,
  signTransaction
} from "@stellar/freighter-api";
import {
  getXlmBalance,
  getCampaignGoal,
  getCampaignTotalRaised,
  getUserBadgeTier,
  prepareDonateTransaction,
  submitAndPollTransaction,
  getCampaignEvents,
  CROWDFUNDING_CONTRACT_ID,
  REWARDS_BADGE_CONTRACT_ID
} from "./stellar";
import type { CampaignEvent } from "./stellar";

export default function App() {
  // Wallet state
  const [walletConnected, setWalletConnected] = useState(false);
  const [userAddress, setUserAddress] = useState("");
  const [userBalance, setUserBalance] = useState("0");
  const [userBadgeTier, setUserBadgeTier] = useState(0);

  // Campaign state
  const [goal, setGoal] = useState<number>(1000);
  const [raised, setRaised] = useState<number>(0);
  const [events, setEvents] = useState<CampaignEvent[]>([]);

  // Action states
  const [donateAmount, setDonateAmount] = useState<string>("50");
  const [loadingAction, setLoadingAction] = useState<string>(""); // "", "preparing", "freighter", "chain", "success", "error"
  const [errorMessage, setErrorMessage] = useState("");
  const [successTxHash, setSuccessTxHash] = useState("");

  // UI States
  const [activeTab, setActiveTab] = useState<"all" | "donations" | "badges">("all");

  // Fetch campaign details and events
  const loadCampaignData = async () => {
    try {
      const liveGoal = await getCampaignGoal();
      const liveRaised = await getCampaignTotalRaised();
      if (liveGoal > 0) setGoal(liveGoal);
      setRaised(liveRaised);

      const liveEvents = await getCampaignEvents();
      setEvents(liveEvents);
    } catch (e) {
      console.error("Error loading campaign data:", e);
    }
  };

  // Fetch user details
  const loadUserData = async (address: string) => {
    if (!address) return;
    try {
      const balance = await getXlmBalance(address);
      setUserBalance(balance);

      const tier = await getUserBadgeTier(address);
      setUserBadgeTier(tier);
    } catch (e) {
      console.error("Error loading user data:", e);
    }
  };

  // Check if wallet already connected or Freighter exists on mount
  useEffect(() => {
    const initWallet = async () => {
      try {
        const hasFreighter = await isConnected();
        if (hasFreighter && hasFreighter.isConnected) {
          const keyResult = await getAddress();
          if (keyResult && keyResult.address) {
            setUserAddress(keyResult.address);
            setWalletConnected(true);
            loadUserData(keyResult.address);
          }
        }
      } catch (err) {
        console.error("Failed to initialize wallet:", err);
      }
    };

    initWallet();
    loadCampaignData();
  }, []);

  // Poll events and campaign raised amount every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      loadCampaignData();
      if (userAddress) {
        loadUserData(userAddress);
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [userAddress]);

  const handleConnectWallet = async () => {
    try {
      const hasFreighter = await isConnected();
      if (!hasFreighter || !hasFreighter.isConnected) {
        alert("Freighter Wallet is not installed or disabled. Please install it to interact with this dApp.");
        return;
      }
      const keyResult = await requestAccess();
      if (keyResult && keyResult.address) {
        setUserAddress(keyResult.address);
        setWalletConnected(true);
        loadUserData(keyResult.address);
      } else if (keyResult && keyResult.error) {
        alert(`Failed to retrieve address: ${keyResult.error}`);
      }
    } catch (err: any) {
      console.error("Wallet connection failed:", err);
      alert("Failed to retrieve public key from Freighter.");
    }
  };

  const handleDisconnectWallet = () => {
    setUserAddress("");
    setWalletConnected(false);
    setUserBalance("0");
    setUserBadgeTier(0);
  };

  const handleDonate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!walletConnected || !userAddress) {
      handleConnectWallet();
      return;
    }

    const amountNum = parseFloat(donateAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setErrorMessage("Please enter a valid donation amount greater than 0.");
      setLoadingAction("error");
      return;
    }

    if (amountNum > parseFloat(userBalance)) {
      setErrorMessage(`Insufficient balance. You only have ${userBalance} XLM.`);
      setLoadingAction("error");
      return;
    }

    setLoadingAction("preparing");
    setErrorMessage("");
    setSuccessTxHash("");

    try {
      // 1. Build and simulate Soroban transaction
      const unsignedTxXdr = await prepareDonateTransaction(userAddress, amountNum);

      // 2. Request user signature via Freighter
      setLoadingAction("freighter");
      const signResult = await signTransaction(unsignedTxXdr, {
        networkPassphrase: "Test SDF Network ; September 2015",
      });

      if (signResult.error) {
        throw new Error(`Freighter signing error: ${signResult.error}`);
      }

      const signedTxXdr = signResult.signedTxXdr;

      // 3. Submit and poll status
      setLoadingAction("chain");
      const txHash = await submitAndPollTransaction(signedTxXdr);

      setSuccessTxHash(txHash);
      setLoadingAction("success");
      setDonateAmount("50");

      // Reload updated records immediately
      await loadCampaignData();
      await loadUserData(userAddress);

      // Reload again after a 2.5-second delay to ensure ledger indexing propagates fully to RPC nodes
      setTimeout(async () => {
        await loadCampaignData();
        await loadUserData(userAddress);
      }, 2500);
    } catch (err: any) {
      console.error("Donation failed:", err);
      setErrorMessage(err.message || "An unexpected error occurred during transaction execution.");
      setLoadingAction("error");
    }
  };

  // Badge tier helper details
  const getBadgeDetails = (tier: number) => {
    switch (tier) {
      case 1:
        return { name: "Bronze Badge", color: "from-amber-600 to-amber-800", text: "Bronze Contributor" };
      case 2:
        return { name: "Silver Badge", color: "from-slate-300 to-slate-500", text: "Silver Supporter" };
      case 3:
        return { name: "Gold Badge", color: "from-yellow-400 to-yellow-600 animate-pulse", text: "Gold Champion" };
      default:
        return { name: "No Badge", color: "from-gray-700 to-gray-800", text: "Backer" };
    }
  };

  const currentBadge = getBadgeDetails(userBadgeTier);

  // Calculate upcoming badge tier based on current tier & entered amount
  const getUpcomingBadgeInfo = () => {
    const currentDonate = parseFloat(donateAmount) || 0;
    if (userBadgeTier >= 3) return null; // Already maxed out
    
    // Check if donation alone is enough or cumulative
    if (userBadgeTier === 0) {
      if (currentDonate >= 500) return { tier: "Gold", next: 500 };
      if (currentDonate >= 200) return { tier: "Silver", next: 200 };
      if (currentDonate >= 50) return { tier: "Bronze", next: 50 };
      return { tier: "Bronze", next: 50, diff: 50 - currentDonate };
    } else if (userBadgeTier === 1) {
      if (currentDonate >= 450) return { tier: "Gold", next: 500 };
      if (currentDonate >= 150) return { tier: "Silver", next: 200 };
      return { tier: "Silver", next: 200, diff: 150 - currentDonate };
    } else if (userBadgeTier === 2) {
      if (currentDonate >= 300) return { tier: "Gold", next: 500 };
      return { tier: "Gold", next: 500, diff: 300 - currentDonate };
    }
    return null;
  };

  const upcomingBadge = getUpcomingBadgeInfo();

  // Progress calculations
  const progressPercent = Math.min(100, Math.floor((raised / goal) * 100));

  const filteredEvents = events.filter((ev) => {
    if (activeTab === "all") return true;
    if (activeTab === "donations") return ev.type === "donation";
    if (activeTab === "badges") return ev.type === "badge_mint";
    return true;
  });

  return (
    <div className="min-h-screen bg-radial from-slate-900 via-slate-950 to-black text-slate-100 font-sans antialiased">
      {/* Background ambient glowing elements */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-violet-500/10 rounded-full blur-[120px] pointer-events-none" />

      {/* Navigation Header */}
      <nav className="sticky top-0 z-50 backdrop-blur-md bg-slate-950/75 border-b border-slate-800/80 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-400 to-violet-600 flex items-center justify-center font-bold text-white shadow-lg shadow-cyan-500/25">
              L
            </div>
            <div>
              <span className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">
                Lumenova 3.1
              </span>
              <span className="ml-2 px-2 py-0.5 text-[10px] font-semibold bg-cyan-950 text-cyan-400 rounded-full border border-cyan-800/50 uppercase tracking-widest">
                Testnet
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {walletConnected ? (
              <div className="flex items-center gap-3 bg-slate-900/90 border border-slate-800 rounded-full px-4 py-1.5 shadow-inner">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
                <span className="text-sm font-medium text-slate-300">
                  {userAddress.slice(0, 6)}...{userAddress.slice(-6)}
                </span>
                <button
                  onClick={handleDisconnectWallet}
                  className="text-xs text-rose-400 hover:text-rose-300 font-semibold transition ml-2 border-l border-slate-800 pl-3 py-0.5 cursor-pointer"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                onClick={handleConnectWallet}
                className="relative group overflow-hidden rounded-full p-[1px] focus:outline-hidden cursor-pointer"
              >
                <span className="absolute inset-0 bg-gradient-to-r from-cyan-400 to-violet-600 rounded-full transition group-hover:scale-105 duration-300" />
                <div className="px-6 py-2 bg-slate-950 rounded-full relative group-hover:bg-slate-900/80 transition duration-300">
                  <span className="text-sm font-bold bg-gradient-to-r from-cyan-300 to-violet-400 bg-clip-text text-transparent group-hover:text-white">
                    Connect Wallet
                  </span>
                </div>
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-6 py-10 relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Side: Campaign details, Donate & Badge tiers (8 cols) */}
        <div className="lg:col-span-8 flex flex-col gap-8">
          
          {/* Campaign Info & Progress Card */}
          <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800/80 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-cyan-500/10 to-transparent rounded-bl-full pointer-events-none" />
            
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
              <div>
                <h1 className="text-3xl font-black tracking-tight mb-2">
                  Decentralized Crowdfunding Campaign
                </h1>
                <p className="text-slate-400 text-sm max-w-xl">
                  Support development of the Lumenova Soroban suite. All contributions directly issue on-chain reward badges with permanent tier upgrades.
                </p>
              </div>
              <div className="bg-slate-950/80 border border-slate-800 rounded-2xl px-5 py-4 flex flex-col items-end shrink-0 shadow-inner">
                <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Campaign ID</span>
                <a
                  href={`https://stellar.expert/explorer/testnet/contract/${CROWDFUNDING_CONTRACT_ID}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-cyan-400 hover:text-cyan-300 font-mono transition mt-1 underline decoration-dashed"
                >
                  {CROWDFUNDING_CONTRACT_ID.slice(0, 10)}...{CROWDFUNDING_CONTRACT_ID.slice(-10)}
                </a>
              </div>
            </div>

            {/* Live Progress Bar */}
            <div className="mb-6">
              <div className="flex justify-between items-baseline mb-3">
                <div>
                  <span className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-cyan-300 to-violet-400 bg-clip-text text-transparent">
                    {raised.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-slate-400 font-medium ml-2">XLM raised</span>
                </div>
                <div className="text-right">
                  <span className="text-xl font-bold text-slate-200">Goal: {goal.toLocaleString()} XLM</span>
                </div>
              </div>

              {/* Glassmorphic progress container */}
              <div className="w-full h-5 bg-slate-950/95 rounded-full border border-slate-800 overflow-hidden p-0.5 shadow-inner">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-indigo-500 to-violet-600 shadow-[0_0_15px_rgba(6,182,212,0.5)] transition-all duration-700 ease-out"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              <div className="flex justify-between items-center mt-3 text-xs text-slate-500 font-semibold">
                <span>{progressPercent}% Complete</span>
                <span>Active Network: Stellar Testnet</span>
              </div>
            </div>
          </div>

          {/* Interactive Action Forms & Rewards Badge Tiers */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            
            {/* Donation Form Card */}
            <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800/80 rounded-3xl p-6 flex flex-col justify-between shadow-2xl relative">
              <div>
                <h3 className="text-lg font-bold tracking-tight mb-4 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
                  Make a Donation
                </h3>

                <form onSubmit={handleDonate} className="flex flex-col gap-4">
                  {/* Quick-select options */}
                  <div className="grid grid-cols-4 gap-2">
                    {[10, 50, 200, 500].map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => setDonateAmount(amount.toString())}
                        className={`py-2 px-1 text-xs font-bold rounded-xl transition border cursor-pointer ${
                          donateAmount === amount.toString()
                            ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-[0_0_10px_rgba(6,182,212,0.15)]"
                            : "bg-slate-950/65 text-slate-400 border-slate-850 hover:bg-slate-900 hover:text-white"
                        }`}
                      >
                        {amount} XLM
                      </button>
                    ))}
                  </div>

                  {/* Input field */}
                  <div className="relative">
                    <input
                      type="number"
                      value={donateAmount}
                      onChange={(e) => setDonateAmount(e.target.value)}
                      placeholder="Enter custom amount..."
                      min="0.0000001"
                      step="any"
                      required
                      className="w-full bg-slate-950/90 border border-slate-850 focus:border-cyan-500 rounded-2xl py-3.5 pl-4 pr-16 text-slate-100 font-bold focus:outline-hidden transition shadow-inner"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-400 font-bold">
                      XLM
                    </span>
                  </div>

                  {/* Dynamic Reward Estimator */}
                  {upcomingBadge && (
                    <div className="bg-slate-950/80 border border-slate-800/80 rounded-2xl p-4 text-xs">
                      <div className="flex items-center justify-between font-semibold text-slate-300">
                        <span>Target Badge Reward:</span>
                        <span className="text-cyan-400">{upcomingBadge.tier} Tier</span>
                      </div>
                      {upcomingBadge.diff ? (
                        <div className="text-slate-500 mt-1">
                          Add <span className="font-bold text-slate-400">{upcomingBadge.diff.toFixed(1)} XLM</span> more to hit this milestone.
                        </div>
                      ) : (
                        <div className="text-emerald-400 mt-1 flex items-center gap-1 font-medium">
                          ✔ Donation qualifies for the {upcomingBadge.tier} tier!
                        </div>
                      )}
                    </div>
                  )}

                  {/* Donate Button */}
                  <button
                    type="submit"
                    disabled={loadingAction !== "" && loadingAction !== "success" && loadingAction !== "error"}
                    className="w-full cursor-pointer bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white font-bold py-3.5 px-6 rounded-2xl transition shadow-lg shadow-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {!walletConnected
                      ? "Connect Wallet to Donate"
                      : loadingAction === "preparing"
                      ? "Preparing transaction..."
                      : loadingAction === "freighter"
                      ? "Approve in Freighter Wallet..."
                      : loadingAction === "chain"
                      ? "Confirming on Ledger..."
                      : `Donate ${donateAmount} XLM`}
                  </button>
                </form>
              </div>

              {/* Status Message Blocks */}
              <div className="mt-4">
                {loadingAction === "success" && (
                  <div className="bg-emerald-950/80 border border-emerald-800/50 rounded-2xl p-4 text-xs text-emerald-300">
                    <p className="font-bold mb-1">✔ Donation Complete!</p>
                    <p className="mb-2">Your contribution has been written to the ledger.</p>
                    <a
                      href={`https://stellar.expert/explorer/testnet/tx/${successTxHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-cyan-400 hover:text-cyan-300 underline font-semibold break-all"
                    >
                      TX: {successTxHash.slice(0, 18)}...
                    </a>
                  </div>
                )}

                {loadingAction === "error" && (
                  <div className="bg-rose-950/80 border border-rose-800/50 rounded-2xl p-4 text-xs text-rose-300">
                    <p className="font-bold mb-1">❌ Transaction Failed</p>
                    <p className="font-medium break-words">{errorMessage}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Badge Info & Tiers */}
            <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800/80 rounded-3xl p-6 flex flex-col justify-between shadow-2xl relative">
              <div>
                <h3 className="text-lg font-bold tracking-tight mb-4 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-violet-400" />
                  Rewards Badge System
                </h3>

                <p className="text-xs text-slate-400 mb-5 leading-relaxed">
                  Earn on-chain badges based on your total cumulative donation amount. Badges are held in our permanent Rewards Badge contract:
                </p>

                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between bg-slate-950/70 border border-slate-800/60 rounded-xl px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-md bg-amber-600/20 border border-amber-600/40 flex items-center justify-center text-xs font-bold text-amber-500">
                        B
                      </span>
                      <span className="text-xs font-bold text-slate-200">Bronze Badge</span>
                    </div>
                    <span className="text-xs font-semibold text-slate-500">50+ XLM</span>
                  </div>

                  <div className="flex items-center justify-between bg-slate-950/70 border border-slate-800/60 rounded-xl px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-md bg-slate-400/20 border border-slate-400/40 flex items-center justify-center text-xs font-bold text-slate-300">
                        S
                      </span>
                      <span className="text-xs font-bold text-slate-200">Silver Badge</span>
                    </div>
                    <span className="text-xs font-semibold text-slate-500">200+ XLM</span>
                  </div>

                  <div className="flex items-center justify-between bg-slate-950/70 border border-slate-800/60 rounded-xl px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-md bg-yellow-400/20 border border-yellow-400/40 flex items-center justify-center text-xs font-bold text-yellow-400">
                        G
                      </span>
                      <span className="text-xs font-bold text-slate-200">Gold Badge</span>
                    </div>
                    <span className="text-xs font-semibold text-slate-500">500+ XLM</span>
                  </div>
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-slate-800/80">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500 font-semibold">Badge Contract</span>
                  <a
                    href={`https://stellar.expert/explorer/testnet/contract/${REWARDS_BADGE_CONTRACT_ID}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-violet-400 hover:text-violet-300 font-mono transition underline"
                  >
                    {REWARDS_BADGE_CONTRACT_ID.slice(0, 6)}...{REWARDS_BADGE_CONTRACT_ID.slice(-6)}
                  </a>
                </div>
              </div>
            </div>
            
          </div>

        </div>

        {/* Right Side: User Profile & Live Activity Feed (4 cols) */}
        <div className="lg:col-span-4 flex flex-col gap-8">
          
          {/* User Profile Card */}
          <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800/80 rounded-3xl p-6 shadow-2xl relative overflow-hidden">
            <h3 className="text-lg font-bold tracking-tight mb-4 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-400" />
              Contributor Profile
            </h3>

            {walletConnected ? (
              <div className="flex flex-col gap-4">
                {/* Balance display */}
                <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 flex justify-between items-center shadow-inner">
                  <div>
                    <span className="text-xs text-slate-500 font-semibold block uppercase tracking-wider">Your Balance</span>
                    <span className="text-2xl font-bold tracking-tight text-slate-100">
                      {parseFloat(userBalance).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                    </span>
                    <span className="text-slate-400 font-medium ml-1.5 text-sm">XLM</span>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-slate-900 flex items-center justify-center border border-slate-850 font-extrabold text-sm text-cyan-400 shadow-sm">
                    ¤
                  </div>
                </div>

                {/* Badge card display */}
                <div className="relative overflow-hidden rounded-2xl border border-slate-800/60 p-[1px] mt-1">
                  <div className={`absolute inset-0 bg-gradient-to-r ${currentBadge.color}`} />
                  <div className="bg-slate-950/95 relative rounded-2xl p-4 flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${currentBadge.color} flex items-center justify-center text-xl font-black text-white shadow-md`}>
                      {userBadgeTier > 0 ? currentBadge.name.slice(0, 1) : "Ø"}
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 font-semibold block uppercase tracking-wider">Tier Badge</span>
                      <span className="text-base font-extrabold text-slate-200">
                        {currentBadge.name}
                      </span>
                      <span className="block text-[10px] text-slate-400 font-semibold mt-0.5">
                        {currentBadge.text}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-6 text-center shadow-inner flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-xl text-slate-500">
                  ?
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-300">Wallet Not Connected</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-[200px] mx-auto">
                    Please connect Freighter to view your XLM balance and earned badges.
                  </p>
                </div>
                <button
                  onClick={handleConnectWallet}
                  className="mt-2 cursor-pointer bg-slate-900 hover:bg-slate-850 border border-slate-800 text-xs font-bold px-4 py-2 rounded-xl text-cyan-400 hover:text-cyan-300 transition"
                >
                  Connect Wallet
                </button>
              </div>
            )}
          </div>

          {/* Live Feed Event Card */}
          <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800/80 rounded-3xl p-6 shadow-2xl flex flex-col grow min-h-[400px]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold tracking-tight flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                Live Campaign Feed
              </h3>
              <button
                onClick={loadCampaignData}
                className="text-xs font-bold text-cyan-400 hover:text-cyan-300 transition cursor-pointer"
              >
                Refresh
              </button>
            </div>

            {/* Filter Tabs */}
            <div className="grid grid-cols-3 bg-slate-950/90 border border-slate-800 rounded-xl p-1 mb-4 shadow-inner">
              {(["all", "donations", "badges"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`text-[10px] font-bold rounded-lg py-1 px-0.5 cursor-pointer uppercase tracking-wider transition ${
                    activeTab === tab
                      ? "bg-slate-900 text-cyan-400 shadow-sm"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Feed Scroll List */}
            <div className="grow overflow-y-auto max-h-[420px] flex flex-col gap-3 pr-1.5 custom-scrollbar">
              {filteredEvents.length > 0 ? (
                filteredEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className="bg-slate-950/70 border border-slate-850 rounded-xl p-3.5 hover:border-slate-800 transition flex flex-col gap-2 relative overflow-hidden group"
                  >
                    <div className="flex justify-between items-start">
                      <span className="text-[10px] font-semibold text-slate-500">
                        Ledger #{ev.ledger}
                      </span>
                      <a
                        href={`https://stellar.expert/explorer/testnet/tx/${ev.id.split("-")[0]}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-cyan-500 hover:underline opacity-0 group-hover:opacity-100 transition"
                      >
                        Details ↗
                      </a>
                    </div>

                    <div className="flex items-center gap-2.5">
                      <div className={`w-8 h-8 rounded-lg shrink-0 flex items-center justify-center text-xs font-black ${
                        ev.type === "donation"
                          ? "bg-emerald-950/60 border border-emerald-800/40 text-emerald-400"
                          : "bg-violet-950/60 border border-violet-800/40 text-violet-400"
                      }`}>
                        {ev.type === "donation" ? "$" : "★"}
                      </div>
                      <div className="leading-tight">
                        <p className="text-xs font-bold text-slate-200">
                          {ev.type === "donation"
                            ? `Donated ${ev.amount} XLM`
                            : `Minted ${ev.tier} Badge`}
                        </p>
                        <p className="text-[10px] text-slate-500 font-medium truncate max-w-[200px] mt-0.5">
                          by {ev.actor.slice(0, 8)}...{ev.actor.slice(-8)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-10 text-slate-600 text-xs font-medium">
                  No recent events found.
                  <br />
                  Be the first to donate and start the stream!
                </div>
              )}
            </div>

          </div>

        </div>

      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-8 border-t border-slate-900/60 mt-16 text-center text-xs text-slate-500 font-semibold">
        <p>Lumenova 3.1 Crowdfunding Campaign. Deployed on Stellar Testnet.</p>
        <p className="mt-1 font-mono text-[10px] text-slate-600">
          Crowdfunding: {CROWDFUNDING_CONTRACT_ID} | Rewards: {REWARDS_BADGE_CONTRACT_ID}
        </p>
      </footer>
    </div>
  );
}
