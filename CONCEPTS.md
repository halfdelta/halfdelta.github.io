# Concepts

Three directions for the placeholder page. Each one is a single visual idea and very little text.

## A. The fixed point

A family of S-curves, wide and gentle at first, then steeper and steeper until they become a step. Every curve passes through one point at the exact middle, which never moves. A small dot drifts at random along the current curve. Near the middle, a small sideways move makes it jump up or down. At the end of the cycle the curve is a step, the dot settles at the top or the bottom, and the cycle starts again. The name sits next to the fixed point like a label on a chart, with one quiet line: "Precise about uncertainty." Mood: a well-made instrument, calm and exact, with a hint of suspense.

## B. Half step

A fine grid of points, sampled again and again, with each new pass halving the spacing. A rough, noisy outline gets sharper with each pass until one smooth line is left, and then the grid dissolves. The copy is the name and "Measure twice." Mood: patient refinement, close to a lab notebook.

## C. Even odds

Thousands of faint random paths leave one point and spread out over time. The page splits them into two halves, above and below a single horizontal line, and the two halves stay almost exactly balanced. The name sits on the line. Mood: weather, large numbers, the quiet of a coin that has not landed yet.

## Choice: A, the fixed point

A is the only option where the image *is* the name. Half delta is the one point that every curve shares, and the animation shows it without explaining it. A technical visitor sees curves pinned through a single point, steepening as time runs out, and a dot that moves most where the odds are even. Anyone who knows the math recognises it. Everyone else sees a precise, slightly hypnotic drawing.

A also stays readable when nothing moves. Drawn once as a still fan of curves, it works as the no-JavaScript and reduced-motion version with nothing lost. B needs motion to make sense. C, with many paths, drifts toward a generic "data" screensaver and costs more on phones.

### Design tokens

| Token | Light | Dark |
|---|---|---|
| paper | `#ECEEEA` cool fog | `#0E151E` night ink |
| ink | `#16202C` | `#DCE2E9` |
| muted (tagline) | `#4A5563` (6.5:1) | `#97A3B1` (7.2:1) |
| signal (live curve, dot) | `#2747C9` cobalt (6.4:1) | `#8FA4FF` (7.8:1) |

- Type: the wordmark uses the platform's book serif (Iowan Old Style, Palatino, Charter, Georgia). The tagline uses the system sans. No web fonts, no capitals-only labels, no monospace decoration.
- Layout: a chart with no axes labels. The fixed point sits at the centre on wide screens and at 30% from the left on phones. The text sits in the lower-right quadrant, which no S-curve ever crosses, joined to the point by a short leader line.
- Principle: the drawing is the one bold element. Everything else is a label on it.

### Copy alternatives for the owner

- Precise about uncertainty. (chosen)
- Measured at even odds.
- Where the odds are even.
- No line at all, only the name.

## v2: the S becomes infinity

The owner asked for a loop that turns into something else and comes back, with infinity as one option. v2 is one continuous loop with no fade to blank. It lasts 26 seconds.

- **0–10 s:** the S steepens and the fan builds, as in v1. The dot drifts at random.
- **10–14 s:** the S opens into an infinity sign. Its tails wind into two loops, and a second strand peels off the S and swings down to the horizontal. The fan fades out.
- **14–20 s:** the infinity holds and the dot glides around it.
- **20–26 s:** the infinity unwinds into the wide S. The dot arrives back at the fixed point just as the S settles, and the next loop carries on from there.

The infinity crosses itself exactly at the fixed point: half delta is where infinity meets itself. The shape is a lemniscate of Bernoulli turned 45 degrees. It leaves the crossing vertically, like the steep S, and horizontally, along the axis. Its two loops sit in the same quadrants as the S-curves, so the name's quadrant stays clear. Both shapes are four strands, resampled evenly along their length and blended point by point. The centre stays pinned throughout.

Without JavaScript, or with reduced motion, the page shows the fan with the infinity drawn through it.

## v3: five shapes through one point

The owner asked for more shapes, a dot that slides freely, and infinity kept last. v3 is one 45.5-second seamless loop of five shapes. Each one passes through the fixed point, and each morphs into the next over 3.5 seconds.

| Time | Shape | What it is |
|---|---|---|
| 0–7 s | **S (delta)** | The S-curve steepens and the faint fan builds. Delta: how much an option moves with its underlying. |
| 7–10.5 s | S → bell | The fan fades. |
| 10.5–14.5 s | **Bell (gamma)** | A normal curve standing on the axis, its peak right above the fixed point. Gamma is the slope of delta, and it peaks at the money. |
| 14.5–18 s | bell → smile | |
| 18–22 s | **Smile (vega)** | The volatility smile: lowest at the money, rising toward the wings. |
| 22–25.5 s | smile → spiral | |
| 25.5–31 s | **Spiral** | The Cornu (Euler) spiral. It winds up, holds, and unwinds. Its arms wind toward the points (½, ½) and (−½, −½): one half, again. |
| 31–34.5 s | spiral → infinity | |
| 34.5–39.5 s | **Infinity** | The lemniscate, crossing itself at the fixed point. |
| 39.5–45.5 s | infinity → S | Unwinds into the wide S, unchanged from v2. This is the seam. |

The dot slides along the whole of each shape at a calm, steady pace. It slows in tight turns and turns back gently before it would leave the screen, and its place on the path carries over from shape to shape. When a coming morph would carry its stretch of path off screen, it heads back toward the fixed point. Only the S keeps a fan of earlier curves.

Two shapes were tried and dropped:

- **A circle (theta, time)** between the bell and the spiral. A circle turns one way all the way round, while the spiral and the infinity turn both ways, so the blend from the circle to the spiral pinched into a cusp.
- **A Lissajous figure or a rose.** These cross the lower-right quarter, where the name sits.

The volatility smile took the circle's place. It still tells the options story: delta, gamma, vega, then a turn toward something stranger.

## v4: three shapes, drawn out of the point

The owner kept three shapes (the S, the spiral and the infinity), asked for a different kind of transition, and asked for more path tracing, like the fan in v1. v4 is one 32-second seamless loop.

| Time | What happens |
|---|---|
| 0–8 s | **S (delta)** steepens. Each width it passes leaves a faint copy, building the fan from v1. |
| 8–11.5 s | The S is left in place and fades. The **spiral** is drawn out of the fixed point. |
| 11.5–18.5 s | **Spiral** tightens and grows. Earlier windings stay behind as afterimages. |
| 18.5–22 s | The spiral and its afterimages fade. The **infinity** is drawn out of the point. |
| 22–28 s | **Infinity**: the loops breathe outward, leaving a fan of smaller loops. |
| 28–32 s | The infinity fades. The wide **S** is drawn out of the point, and the loop goes on. |

**The transition.** Before each change, the dot glides home to the fixed point and comes to rest there. The old shape stays where it is and fades to a ghost, with its fan. The new shape is drawn outward from the point along all its strands at once. The dot rides the tip of one strand, as the pen, at about its usual speed, and then carries on along the new shape. Nothing moves except the drawing and the dot.

Three options were prototyped:

- **Draw out of the point while the old shape fades (chosen).** It is the calmest of the three: one motion at a time, and the old shape becomes part of the trace instead of being taken away.
- **Draw out of the point while the old shape winds back into it.** Two motions in opposite directions through one point read as busy, and a steep S winding back leaves a brief straight chord.
- **The dot draws the whole new shape in one stroke.** At a calm speed an infinity takes about 13 seconds to draw, so the pen would have to hurry.

**The trace.** Each phase leaves faint ink-coloured copies: about 20 for the S, 9 for the spiral and 8 for the infinity. They fade over five seconds once their phase ends. The dot's trail is longer, about 1.6 seconds, with a soft wide stroke under a fine one and a faint halo on the dot.
