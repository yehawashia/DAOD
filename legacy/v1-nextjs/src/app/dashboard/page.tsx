import React from "react";
// import { redirect } from "next/navigation";
// import { auth } from "@clerk/nextjs/server"; 

export default function TeacherDashboardPage() {
  // TODO: Paid-tier verification
  // const { userId /*, sessionClaims*/ } = await auth();
  // const isPaidTier = ...;
  // if (!isPaidTier) {
  //   redirect("/upgrade");
  // }

  return (
    <div className="min-h-screen bg-black text-[#f0ede6] font-serif flex">
      {/* Sidebar */}
      <aside className="w-64 border-r border-white/10 flex flex-col pt-12 pb-6 px-8">
        
        {/* Logo Area */}
        <div className="mb-16">
          <div className="text-3xl font-normal tracking-widest leading-none mb-2">DAOD</div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-white/40">Teacher Portal</div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 flex flex-col gap-6 text-[15px] text-white/50">
          <a href="#" className="text-white hover:text-white transition-colors flex items-center gap-3">
            <span className="w-1.5 h-1.5 rounded-full bg-current" />
            Overview
          </a>
          <a href="#" className="hover:text-white transition-colors flex items-center gap-3">
            <span className="w-1.5 h-1.5 rounded-full bg-transparent group-hover:bg-current" />
            Students
          </a>
          <a href="#" className="hover:text-white transition-colors flex items-center gap-3">
            <span className="w-1.5 h-1.5 rounded-full bg-transparent group-hover:bg-current" />
            Topics
          </a>
          <a href="#" className="hover:text-white transition-colors flex items-center gap-3">
            <span className="w-1.5 h-1.5 rounded-full bg-transparent group-hover:bg-current" />
            Settings
          </a>
        </nav>

        {/* Bottom profile/exit stub if needed */}
        <div className="text-sm text-white/30 hover:text-white/60 transition cursor-pointer">
          Sign out
        </div>
      </aside>

      {/* Main Area */}
      <main className="flex-1 px-16 py-12 flex flex-col">
        <header className="mb-14">
          <h1 className="text-4xl font-normal tracking-wide mb-3">Overview</h1>
          <p className="text-white/40 text-sm tracking-wide">Monitor student engagement and generative output.</p>
        </header>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          <MetricCard title="Topics Generated" value="1,204" subtitle="+12% this week" />
          <MetricCard title="Active Students" value="84" subtitle="3 currently learning" />
          <MetricCard title="Avg Session Length" value="14m" subtitle="Above average" />
          <MetricCard title="Most Asked Topic" value="Linear Alg" subtitle="Vector spaces" />
        </div>

        {/* Placeholder for future charts / deep dives */}
        <div className="mt-12 flex-1 rounded-sm border border-white/10 flex items-center justify-center p-8 text-white/20 text-sm tracking-widest uppercase">
          [ Analytics Canvas ]
        </div>
      </main>
    </div>
  );
}

function MetricCard({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return (
    <div className="border border-white/10 p-6 flex flex-col gap-4 bg-[#0a0a0a] hover:bg-[#111] transition duration-300">
      <h3 className="text-white/50 text-sm tracking-wide">{title}</h3>
      <div className="text-4xl font-normal">{value}</div>
      <div className="text-white/30 text-xs tracking-wider">{subtitle}</div>
    </div>
  );
}
