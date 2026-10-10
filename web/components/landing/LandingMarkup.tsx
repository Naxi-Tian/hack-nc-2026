import type { CSSProperties } from "react";
import HeroText from "@/components/HeroText";

// Static landing markup. Interactive parts (tape, board, desk, round page, WebGL plate)
// are filled in by LandingFX after mount; ids here are its contract.
const FORMULA = '<span class="c"># valuation-model-v1 · demo anchors, not market data</span>\nscore      = <span class="k">0.30</span>·product + <span class="k">0.30</span>·traction\n           + <span class="k">0.25</span>·team    + <span class="k">0.15</span>·financial\nmultiplier = 0.50 + score / 100\nanchor     = stage_anchor × multiplier\nband       = [anchor × 0.60, anchor × 1.50]\nunit_price = anchor / founder_units';

export default function LandingMarkup() {
  return (
    <>


<div className="tape" aria-label="Open rounds ticker"><div className="tape-track" id="tape"></div></div>

<header className="page">
  <div className="dateline">
    <span className="mid">Saturday, October 10, 2026</span>
  </div>
  <div className="masthead">
    <div className="ear l">Today’s issue<em>8 rounds open, 3 from dorm rooms</em></div>
    <h1>The Prospecto</h1>
    <div className="ear r">Price of this paper<em>Free. Backers get demo credits.</em></div>
  </div>
  <div className="motto">All the companies too early to list.</div>
  <nav className="sections" aria-label="Sections">
    <a href="#how">How It Works</a>
    <a href="#desk">Estimate Desk</a>
    <a href="/news/">News</a>
    <a href="/launch/">List Your Company</a>
    <a href="/rounds/" className="open">Open Rounds &rarr;</a>
  </nav>
</header>

<main className="page" id="front">
  <section className="front">
    <article className="lead">
      <div className="kicker"><b>Extra</b> &nbsp;·&nbsp; Primary issuance &nbsp;·&nbsp; Any stage</div>
      <HeroText as="h2" id="headline" text="Your half‑built idea now has" em="backers." />

      <figure className="figure">
        <div className="plate">
          <canvas id="halftone" aria-hidden="true"></canvas>
          <span className="tag a">Fig. 1 &mdash; The prospect</span>
          <span className="tag b">Stage: Idea &rarr; Growth</span>
        </div>
        <figcaption>
          <span>The view from the idea stage. Every ridge here started as a flat line. <em>Move your cursor to change the light.</em></span>
          <span className="mono">Halftone · 15° screen · live</span>
        </figcaption>
      </figure>
    </article>

    <aside className="side">
      <div className="cta-box">
        <p className="deck">Prospecto lets founders at any stage &mdash; a dorm-room idea, a scrappy prototype, the first paying customers &mdash; publish a transparent valuation, set a fixed price, and put one <em>“Invest in us”</em> link on their website. Backers buy units directly from the startup.</p>
        <div className="byline">By the Prospecto desk &nbsp;·&nbsp; Filed 9:41 a.m.</div>
        <div className="btns">
          <a className="btn go" href="/launch/">List your company &rarr;</a>
          <a className="btn" href="/rounds/">Browse rounds</a>
        </div>
      </div>
      <div className="bell">
        <div><strong>8</strong><span>Rounds open</span></div>
        <div><strong>$412,880</strong><span>Demo credits raised</span></div>
      </div>
      <div className="brief">
        <div className="kicker">In brief</div>
        <h3>Idea-stage teams are welcome.</h3>
        <p>Five stages, from <span className="mono" style={{ fontSize: '13px' }}>IDEA</span> to <span className="mono" style={{ fontSize: '13px' }}>GROWTH</span>, are recorded separately from incorporation. An unincorporated project is labeled exactly that.</p>
      </div>
      <div className="brief">
        <h3>Every unit comes from the startup.</h3>
        <p>No order book, no resale, no leverage. Each purchase is new issuance at the founder’s fixed price, and the proceeds land in the round account.</p>
      </div>
      <div className="brief">
        <h3>The estimate shows its work.</h3>
        <p>Inputs, weights, model version and a sensitivity band are printed next to every suggested price. The founder can override it, with a reason on the record.</p>
      </div>
    </aside>
  </section>

  {/* split-flap */}
  <section className="board-wrap" id="prices">
    <div className="sec-head">
      <h2>Opening Prices <i>&mdash; today’s issuances</i></h2>
      <span className="kicker">Fixed per round · 1,000,000 founder units · updated live</span>
    </div>
    <div className="board" id="board" data-scroll-reveal="single" role="table" aria-label="Open rounds">
      <div className="brow head" role="row"><span>TICKER</span><span className="name">COMPANY</span><span>STAGE</span><span>PRICE</span><span>SUBSCRIBED</span></div>
    </div>
    <div className="board-foot"><span>Prices are founder-approved and do not move during a round.</span><span>All companies shown are fictional demo fixtures.</span></div>
  </section>

  {/* how it works */}
  <section className="story" id="how">
    <div className="sec-head">
      <h2>How a round opens <i>in five dispatches</i></h2>
      <span className="kicker">Founder journey · about 15 minutes</span>
    </div>
    <div className="cols5" data-scroll-reveal="stagger">
      <div className="step"><span className="no">No. 1</span><h3>Profile</h3><p className="dropcap">Write the story, not a deck. Stage, sector, founders, website and LinkedIn links. You choose which numbers are public and which stay private.</p><span className="stamp">&rarr; Public with consent</span></div>
      <div className="step"><span className="no">No. 2</span><h3>Estimate</h3><p>An open, versioned formula scores product, traction, team and financial readiness against your stage, then shows every assumption and a sensitivity band.</p><span className="stamp">&rarr; valuation-model-v1</span></div>
      <div className="step"><span className="no">No. 3</span><h3>Price</h3><p>Accept the anchor or override it with a reason. Set a fixed unit price and a finite cap on new units. Published terms never quietly change.</p><span className="stamp">&rarr; Immutable terms</span></div>
      <div className="step"><span className="no">No. 4</span><h3>Link</h3><p>Paste one “Invest in us” link on your site, your bio, your demo-day slide. Anyone who believes early follows it straight to your round.</p><span className="stamp">&rarr; One URL</span></div>
      <div className="step"><span className="no">No. 5</span><h3>Settle</h3><p>Each purchase debits the backer, credits your round and issues units in one atomic transaction. No double charges. No oversold rounds.</p><span className="stamp">&rarr; Atomic ledger</span></div>
    </div>
  </section>

  {/* estimate desk */}
  <section className="desk" id="desk" data-scroll-reveal="stagger">
    <div className="desk-l">
      <div className="sec-head" style={{ marginBottom: '0' }}>
        <h2>The Estimate Desk</h2>
        <span className="kicker">Try it with your own idea</span>
      </div>
      <div className="stages" role="group" aria-label="Stage" id="stages"></div>
      <div className="sliders" id="sliders"></div>
      <div className="result" aria-live="polite">
        <div className="kicker">Suggested pre-money anchor</div>
        <div className="big" id="est">$1,000,000</div>
        <div className="band" aria-hidden="true"><div className="axis"></div><div className="rng" id="rng"></div><div className="est-pin" id="est-pin"></div></div>
        <div className="band-l"><span id="lo">Low $600,000</span><span id="hi">High $1,500,000</span></div>
        <div className="facts">
          <div><span>Score</span><b id="score">50.0</b></div>
          <div><span>Unit price</span><b id="unit">$1.00</b></div>
          <div><span>Raise at 10% cap</span><b id="raise">$100,000</b></div>
        </div>
      </div>
    </div>
    <div className="desk-r">
      <div className="kicker">Clipping · The formula, in full</div>
      <div className="clip"><pre dangerouslySetInnerHTML={{ __html: FORMULA }} /></div>
      <p className="note">Unknown answers score zero and lower evidence quality. That isn’t a verdict on your company; it just means we haven’t seen the evidence yet. A higher claim never creates credits or verification.</p>

      <div className="advert">
        <span className="kicker">Advertisement · for your website</span>
        <h3>Paste one line.<br />Meet your first backers.</h3>
        <code>&lt;a href=<span className="t">&quot;https://prospecto.finance/i/mothlight&quot;</span>&gt;Invest in us &rarr;&lt;/a&gt;</code>
        <a className="invest-link" href="/rounds/">Invest in Mothlight <b>&rarr;</b></a>
      </div>
    </div>
  </section>

  {/* classifieds + corrections */}
  <section className="lower" id="corrections">
    <div className="classifieds">
      <div className="sec-head"><h2>Classifieds <i>&mdash; who it’s for</i></h2><span className="kicker">Fictional listings</span></div>
      <div className="ads" data-scroll-reveal="stagger">
        <div className="ad"><span className="what">Wanted: first believers</span><p>Two sophomores, one napkin sketch, a waitlist of 40. No code yet. We want the people who’ll say they were here first.</p><span className="meta">MOTH · IDEA · $0.10 / unit</span></div>
        <div className="ad"><span className="what">For issue: 100,000 units</span><p>Soil sensor prototype, tested on three farms near Pittsboro. Unincorporated, and our profile says so up front.</p><span className="meta">TIDE · PROTOTYPE · $0.56 / unit</span></div>
        <div className="ad"><span className="what">Seeking: pre-revenue fans</span><p>Note-taking app with 1,200 weekly users across four campuses. Launched, honest about our burn, and closing Friday.</p><span className="meta">QUIL · LAUNCHED · $1.13 / unit</span></div>
      </div>
    </div>
    <aside className="corrections" data-scroll-reveal="single" style={{ '--reveal-delay': '160ms' } as CSSProperties}>
      <h3>Corrections &amp; Clarifications</h3>
      <p>Most pitches overstate something on page one. Here’s what this one doesn’t claim.</p>
      <p>Units issued on Prospecto today are <b>simulated</b>. They’re bought with free demo credits and carry no legal ownership, cash value, redemption or dividends.</p>
      <p>The estimate is a transparent heuristic with invented stage anchors, not an appraisal or investment advice.</p>
      <p>Followers aren’t investors, and popularity isn’t value. Participation receipts are not equity or shares, and never convert into them.</p>
    </aside>
  </section>
</main>

{/* B1 · open rounds */}
<section className="b1" id="rounds">
  <div className="page b1-head">
    <div className="sec-head" style={{ marginBottom: '0' }}>
      <h2>Section B1 &mdash; <i>Open Rounds</i></h2>
      <span className="kicker">Keep scrolling. The paper turns into the product.</span>
    </div>
  </div>
  <div className="page">
    <div className="stage" id="stage">
      <div className="term" id="term">
        <div className="tnav t-chrome">
          <span className="logo">P</span>
          <a className="on" href="#rounds">Round</a><a href="/rounds/">Explore</a><a href="/launch/">Founders</a><a href="/news/">News</a>
          <div className="search"><span>Search companies, founders, campuses</span><kbd>/</kbd></div>
          <div className="bal">Demo credits <b>10,000.00</b></div>
        </div>
        <div className="tgrid">
          <aside className="panel book">
            <div className="ptabs t-chrome"><span className="on">Fills</span><span>Backers</span></div>
            <div className="cap t-in">
              <div className="lbl"><span>Round capacity</span><span>100,000 units</span></div>
              <div className="meter"><i></i></div>
              <div className="nums"><span className="up">61,400 issued</span><span>38,600 left</span></div>
            </div>
            <div className="fills" id="fills">
              <div className="fh"><span>Time</span><span>Units</span><span>Total</span></div>
            </div>
          </aside>
          <div className="panel center">
            <div className="chead t-in">
              <div className="cname">
                <div className="k">FERN <em>Revenue</em> <em>Simulated units</em></div>
                <h3>Fernhill Robotics</h3>
              </div>
              <div className="cprice">$2.36<small>FIXED · FOUNDER-APPROVED</small></div>
              <div className="cstats">
                <div><span>Pre-money</span><b>$2.36M</b></div>
                <div><span>Raised</span><b className="up">$144,904</b></div>
                <div><span>Backers</span><b>214</b></div>
                <div><span>Evidence</span><b>Medium</b></div>
              </div>
            </div>
            <div className="ctools t-in"><span>1D</span><span>1W</span><span className="on">Round</span><span className="r">Units issued · cumulative</span></div>
            <div className="chart t-in"><svg id="chart" aria-label="Units issued over the round"></svg></div>
            <div className="ctabs t-chrome"><span className="on">Story</span><span>Founders (3)</span><span>Terms</span><span>Updates (6)</span></div>
            <div className="about t-in"><b>Fernhill Robotics</b> builds a $900 weeding robot for small vegetable farms. It started as an NC State senior design project and now has 31 paying farms. Revenue figures are self-reported, dated August 2026.</div>
          </div>
          <aside className="panel bp">
            <div className="bpanel">
              <div className="ptabs t-chrome"><span className="on">Buy units</span><span>Watch</span></div>
              <div className="qty t-in"><span className="n" id="qn">1,000</span><span className="u">UNITS</span></div>
              <div className="chips t-in" id="chips"><button data-q="100">100</button><button data-q="500">500</button><button data-q="1000" className="on">1K</button><button data-q="4237">Max</button></div>
              <div className="quote t-in">
                <div><span>Unit price</span><b>$2.36</b></div>
                <div><span>Fee</span><b>$0.00</b></div>
                <div><span>Allocation at full round</span><b id="qa">0.0909%</b></div>
                <div className="tot"><span>Total</span><b id="qt">$2,360.00</b></div>
              </div>
              <button className="buy t-in" id="buy">Buy 1,000 units</button>
              <p className="fine t-in">Demo credits only. Units are virtual, bought directly from Fernhill, and can’t be resold.</p>
              <div className="closes t-in"><span>Round closes</span><b id="cd">12d 04:11:09</b></div>
            </div>
          </aside>
        </div>
      </div>
      <div className="paper" id="paper" aria-hidden="true">
        <div className="paper-head"><span className="kicker">Late edition · how to read a round</span><h3>One company. One fixed price. <i>Three columns.</i></h3></div>
        <div><span className="kicker">Column one</span><h4>Who already backed it.</h4><p>Every purchase is printed the moment it settles: time, units, total. No bids, no asks, just people who believed early.</p></div>
        <div><span className="kicker">Column two</span><h4>One company, one fixed price, one honest chart.</h4><p>The price doesn’t move. The line that rises is how much of the round has been issued.</p><p>The founders’ story, team and dated evidence sit right underneath.</p><blockquote>“Nobody bids. Nobody asks. You either believe early, or you watch.”</blockquote></div>
        <div><span className="kicker">Column three</span><h4>Pick a quantity. Get an exact quote.</h4><p>The quote shows unit price, fee and your allocation at full subscription. Then you confirm once.</p></div>
      </div>
    </div>
  </div>
</section>

<footer className="page">
  <div className="colophon" data-scroll-reveal="single">
    <span className="mark">The Prospecto</span>
    <p>Printed on black at prospecto.finance. Built at HackNC 2026. Every company on this page is a fictional fixture, every unit is simulated, and the estimate is a demo heuristic.</p>
    <nav><a href="/rounds/">Rounds</a><a href="/launch/">List</a><a href="/news/">News</a><a href="https://github.com/avidnerd/hack-nc-2026">GitHub</a></nav>
  </div>
</footer>


    </>
  );
}
