"""NIMI (Tiny Orbit) — layered rig: shadow / lift / squash / face / eyes / feet / orbit-lag / moon."""
import math, itertools

_ids = itertools.count(1)

INK = "#2A2340"
MOUTH = "#5A2A44"
TONGUE = "#FF9FB4"
BODY = "#B4C0FF"
DEEP = "#9DABF5"
MIST = "#E3E8FF"
MOON = "#FFE7A0"
CRATER = "#F2CF73"
ROSE = "#FFB6C9"
CORAL = "#FF9B9B"
CORAL_D = "#F07C7C"
VB = "-4 24 208 208"
CX, CY, RX, RY, TILT = 100, 146, 92, 24, -14
BODY_D = "M100 72 C146 72 168 112 168 150 C168 186 140 204 100 204 C60 204 32 186 32 150 C32 112 54 72 100 72 Z"
PERIM = 2 * math.pi * math.sqrt((RX**2 + RY**2) / 2)

EO = "animation-timing-function:cubic-bezier(.2,.8,.3,1)"   # rising / decelerating
EI = "animation-timing-function:cubic-bezier(.6,0,.85,.4)"  # falling / accelerating
IO = "animation-timing-function:cubic-bezier(.45,0,.55,1)"
LIN = "animation-timing-function:linear"


def T(x=0, y=0):
    return f"translate({x}px,{y}px)"


def S(x=1, y=None):
    return f"scale({x},{x if y is None else y})"


# ------------------------------------------------------------------ motion specs
# mood -> dict(D=seconds, layers={layer: [(pct, transform, extra)]}, delays={layer: s}, svg=keyframes on whole svg)
def k(*frames):
    return list(frames)


MOTION = {
    "idle": dict(D=8, layers=dict(
        lift=k((0, T()), (63, T(), EO), (67, T(0, -12), EI), (71, T()), (100, T())),
        sq=k((0, S(), IO), (12.5, S(1.02, .975), IO), (25, S(), IO), (37.5, S(1.02, .975), IO), (50, S(), IO), (61, S()),
             (63.5, S(1.07, .92)), (66, S(.95, 1.06)), (69, S(.99, 1.01)), (71, S(1.06, .93)), (74, S(.98, 1.02)), (77, S(1.01, .99)),
             (80, S(), IO), (90, S(1.02, .975), IO), (100, S())),
        sh=k((0, S()), (63, S(), EO), (67, S(.72), EI), (71, S(1.05)), (75, S()), (100, S())),
        face=k((0, T(), IO), (10, T(), IO), (15, T(4, -1)), (27, T(4, -1), IO), (32, T(), IO), (40, T(), IO), (45, T(-4, 1)), (52, T(-4, 1), IO),
               (57, T()), (63, T()), (66, T(0, 2)), (70, T(0, -2)), (74, T(0, 1)), (78, T()), (100, T())),
        orb=k((0, T()), (63, T()), (66.5, T(0, 6)), (70.5, T(0, -6)), (74.5, T(0, 2.5)), (79, T()), (100, T())),
    )),
    "happy": dict(D=1.5, layers=dict(
        lift=k((0, T()), (18, T(), EO), (42, T(0, -20), EI), (64, T()), (100, T())),
        sq=k((0, S()), (14, S(1.09, .9)), (22, S(.93, 1.09)), (42, S(.99, 1.01)), (60, S(.95, 1.06)), (66, S(1.1, .88)),
             (76, S(.97, 1.03)), (86, S(1.01, .99)), (100, S())),
        sh=k((0, S()), (18, S(), EO), (42, S(.68), EI), (64, S(1.06)), (74, S()), (100, S())),
        face=k((0, T()), (14, T(0, 3)), (24, T(0, -2)), (42, T()), (66, T(0, 3)), (78, T(0, -1)), (90, T()), (100, T())),
        orb=k((0, T()), (20, T(0, 6)), (44, T(0, -2)), (62, T(0, -7)), (72, T(0, 3)), (84, T(0, -1)), (100, T())),
    )),
    "excited": dict(D=1.8, layers=dict(
        lift=k((0, T()), (8, T(), EO), (25, T(0, -26) + " rotate(-6deg)", EI), (42, T()), (50, T(), EO),
               (67, T(0, -26) + " rotate(6deg)", EI), (84, T()), (100, T())),
        sq=k((0, S()), (5, S(1.1, .88)), (11, S(.92, 1.1)), (25, S(.98, 1.02)), (38, S(.94, 1.07)), (43, S(1.12, .86)),
             (47, S(1.1, .88)), (53, S(.92, 1.1)), (67, S(.98, 1.02)), (80, S(.94, 1.07)), (85, S(1.12, .86)), (92, S(.98, 1.02)), (100, S())),
        sh=k((0, S()), (8, S(), EO), (25, S(.62), EI), (42, S(1.08)), (50, S(), EO), (67, S(.62), EI), (84, S(1.08)), (92, S()), (100, S())),
        face=k((0, T()), (5, T(0, 3)), (13, T(0, -2)), (25, T()), (43, T(0, 3)), (53, T(0, -2)), (67, T()), (85, T(0, 3)), (95, T()), (100, T())),
        orb=k((0, T()), (10, T(0, 7)), (25, T(0, -2)), (40, T(0, -8)), (47, T(0, 5)), (53, T(0, 6)), (67, T(0, -2)), (82, T(0, -8)),
              (90, T(0, 4)), (100, T())),
    )),
    "sleeping": dict(D=5, layers=dict(
        sq=k((0, S() + " rotate(0deg)", IO), (45, S(1.045, .95) + " rotate(-2deg)", IO), (100, S() + " rotate(0deg)")),
        face=k((0, T(), IO), (45, T(0, 2), IO), (100, T())),
        sh=k((0, S(), IO), (45, S(1.05), IO), (100, S())),
        moon=k((0, "rotate(-5deg)", IO), (45, "rotate(6deg) translateY(1px)", IO), (100, "rotate(-5deg)")),
    )),
    "curious": dict(D=4, layers=dict(
        sq=k((0, "rotate(0deg)", EO), (12, "rotate(10deg) " + S(.98, 1.02), IO), (40, "rotate(9deg)", IO), (50, "rotate(12deg) " + S(.98, 1.02), IO),
             (70, "rotate(10deg)", IO), (86, "rotate(0deg)"), (100, "rotate(0deg)")),
        lift=k((0, T(), EO), (12, T(4, 0), IO), (70, T(4, 0), IO), (86, T()), (100, T())),
        face=k((0, T(), EO), (14, T(3, -2), IO), (45, T(3, -2), IO), (52, T(1, -3), IO), (70, T(3, -2), IO), (86, T()), (100, T())),
        moon=k((0, T(-10, 8) + " scale(.75)", EO), (16, T() + " scale(1)", IO), (40, T(0, -3), IO), (55, T(2, 0), IO), (74, T(0, -3), IO),
               (88, T(-10, 8) + " scale(.75)"), (100, T(-10, 8) + " scale(.75)")),
        x1=k((0, "scale(0);opacity:0"), (14, "scale(0);opacity:0", EO), (20, "scale(1.25);opacity:1"), (26, "scale(1)"),
             (78, "scale(1);opacity:1"), (88, "scale(.6);opacity:0"), (100, "scale(0);opacity:0")),
    )),
    "surprised": dict(D=3.2, layers=dict(
        lift=k((0, T()), (9, T(), EO), (17, T(0, -18), EI), (25, T()), (100, T())),
        sq=k((0, S()), (6, S(1.06, .94)), (10, S(1.1, .88)), (15, S(.88, 1.16)), (22, S(.97, 1.04)), (26, S(1.08, .92)),
             (31, S(.98, 1.02)), (35, S()), (100, S())),
        eyes=k((0, S()), (12, S()), (17, S(1.3)), (28, S(1.12)), (82, S(1.12), IO), (96, S()), (100, S())),
        face=k((0, T()), (35, T()), (37, T(-1.2, 0)), (39, T(1.2, 0)), (41, T(-1.2, 0)), (43, T(1.2, 0)), (45, T()), (100, T())),
        sh=k((0, S()), (9, S(1.05), EO), (17, S(.7), EI), (25, S(1.08)), (32, S()), (100, S())),
        moon=k((0, T(-14, 86), EO), (10, T(-14, 86), EO), (20, T(4, -6)), (26, T()), (29, T(-1.5, 1)), (32, T(1.5, -1)),
               (35, T(-1, 0)), (38, T()), (78, T(), IO), (96, T(-14, 86)), (100, T(-14, 86))),
        x1=k((0, "scale(.6);opacity:0"), (14, "scale(.6);opacity:0"), (18, "scale(1.15);opacity:1"), (24, "scale(1)"),
             (52, "opacity:1"), (66, "opacity:0"), (100, "opacity:0")),
    )),
    "working": dict(D=2.4, layers=dict(
        lift=k((0, T(), IO), (50, T(0, -3), IO), (100, T())),
        sq=k((0, S(), IO), (50, S(1.012, .99), IO), (100, S())),
        face=k((0, T(-3, -1), LIN), (40, T(3, -1)), (46, T(-3, 1), LIN), (86, T(3, 1)), (92, T(-3, -1)), (100, T(-3, -1))),
    )),
    "error": dict(D=3.4, layers=dict(
        lift=k((0, T()), (2, T(-2, 0)), (4, T(2, 0)), (6, T(-2, 0)), (8, T(2, 0)), (10, T(-1, 0)), (12, T()), (100, T())),
        sq=k((0, S(1.03, .96), IO), (50, S(1.045, .945), IO), (100, S(1.03, .96))),
        face=k((0, T(0, 2), IO), (50, T(-1, 3), IO), (100, T(0, 2))),
        moon=k((0, T(0, -64) + " rotate(-40deg);opacity:0", EI), (4, T(0, -58) + " rotate(-35deg);opacity:1", EI),
               (18, T() + " rotate(0deg)", EO), (27, T(0, -14) + " rotate(12deg)", EI), (35, T() + " rotate(0deg)", EO),
               (41, T(0, -4) + " rotate(-4deg)", EI), (45, T()), (90, T() + ";opacity:1"), (97, T() + ";opacity:0"),
               (100, T(0, -64) + " rotate(-40deg);opacity:0")),
        x1=k((0, S()), (20, S()), (26, S(1.28)), (32, S()), (100, S())),
        x2=k((0, T(0, -4) + ";opacity:0"), (12, T() + ";opacity:1", EI), (62, T(0, 10) + ";opacity:1"), (74, T(0, 14) + ";opacity:0"),
             (100, T(0, 14) + ";opacity:0")),
    )),
    "music": dict(D=1.2, layers=dict(
        sq=k((0, S(1.05, .95) + " rotate(-4deg)"), (25, S(.98, 1.03) + " rotate(0deg)"), (50, S(1.05, .95) + " rotate(4deg)"),
             (75, S(.98, 1.03) + " rotate(0deg)"), (100, S(1.05, .95) + " rotate(-4deg)")),
        face=k((0, T(-1, 2)), (25, T(0, -1.5)), (50, T(1, 2)), (75, T(0, -1.5)), (100, T(-1, 2))),
        fl=k((0, T()), (12, T(0, -5) + " rotate(-12deg)"), (30, T()), (100, T())),
        fr=k((0, T()), (50, T()), (62, T(0, -5) + " rotate(12deg)"), (80, T()), (100, T())),
        orb=k((0, T(0, 1)), (12, T(0, 3)), (37, T(0, -3)), (62, T(0, 3)), (87, T(0, -3)), (100, T(0, 1))),
        sh=k((0, S(1.05)), (25, S(.97)), (50, S(1.05)), (75, S(.97)), (100, S(1.05))),
    ), delays=dict(face=-.06)),
    "attention": dict(D=3, layers=dict(
        lift=k((0, T()), (4, T(), EO), (11, T(0, -12), EI), (18, T()), (22, T(), EO), (29, T(0, -12), EI), (36, T()), (100, T())),
        sq=k((0, S()), (3, S(1.06, .93)), (6, S(.94, 1.07)), (11, S(.99, 1.01)), (16, S(.96, 1.05)), (19, S(1.08, .92)),
             (24, S(.94, 1.07)), (29, S(.99, 1.01)), (34, S(.96, 1.05)), (37, S(1.08, .92)), (42, S(1.04), IO), (82, S(1.05), IO),
             (92, S()), (100, S())),
        sh=k((0, S()), (4, S(), EO), (11, S(.74), EI), (18, S(1.05)), (22, S(), EO), (29, S(.74), EI), (36, S(1.05)), (42, S(1.03)),
             (90, S()), (100, S())),
        face=k((0, T()), (6, T(0, -2)), (18, T(0, 2)), (24, T(0, -2)), (37, T(0, 2)), (44, T(0, -1)), (100, T())),
        moon=k((0, S()), (11, S(1.2)), (18, S()), (29, S(1.2)), (36, S()), (100, S())),
        orb=k((0, T()), (13, T(0, 5)), (20, T(0, -4)), (31, T(0, 5)), (38, T(0, -4)), (46, T()), (100, T())),
    )),
    "bored": dict(D=7, layers=dict(
        sq=k((0, S() + " rotate(-2deg)", IO), (22, S(1.02, 1.035) + " rotate(-1deg)", EO), (36, S(1.04, .94) + " rotate(-4deg)", IO),
             (80, S(1.035, .95) + " rotate(-3.5deg)", IO), (100, S() + " rotate(-2deg)")),
        face=k((0, T(), IO), (40, T(4, 1), IO), (55, T(4, 1), IO), (70, T(-3, 2), IO), (85, T(-3, 2), IO), (100, T())),
        x1=k((0, T() + " scale(.5);opacity:0"), (33, T() + " scale(.5);opacity:0"), (39, T(2, 0) + " scale(.85);opacity:.85"),
             (62, T(16, -2) + " scale(1.35);opacity:0"), (100, "opacity:0")),
    )),
    "grabbed": dict(D=1.8, svg=k((0, "rotate(-9deg)", IO), (50, "rotate(9deg)", IO), (100, "rotate(-9deg)")), layers=dict(
        sq=k((0, S(.96, 1.05), IO), (25, S(.92, 1.1), IO), (50, S(.96, 1.05), IO), (75, S(.92, 1.1), IO), (100, S(.96, 1.05))),
        fl=k((0, "rotate(14deg)", IO), (50, "rotate(-14deg)", IO), (100, "rotate(14deg)")),
        fr=k((0, "rotate(14deg)", IO), (50, "rotate(-14deg)", IO), (100, "rotate(14deg)")),
        moon=k((0, T(-8, 3) + " rotate(-14deg)", IO), (50, T(8, -3) + " rotate(14deg)", IO), (100, T(-8, 3) + " rotate(-14deg)")),
        face=k((0, T(-2, 0), IO), (50, T(2, 0), IO), (100, T(-2, 0))),
    ), delays=dict(fl=-.3, fr=-.22, moon=-.35, face=-.12)),
    "dizzy": dict(D=1.3, svg=k((0, "rotate(-8deg) translateX(-3px)", IO), (50, "rotate(8deg) translateX(3px)", IO),
                                (100, "rotate(-8deg) translateX(-3px)")), layers=dict(
        sq=k((0, S(1.03, .97)), (25, S(.97, 1.03)), (50, S(1.03, .97)), (75, S(.97, 1.03)), (100, S(1.03, .97))),
        face=k((0, T(2, 0), IO), (50, T(-2, 0), IO), (100, T(2, 0))),
        orb=k((0, T(0, -3)), (30, T(2, 3)), (60, T(-2, -1)), (100, T(0, -3))),
    ), delays=dict(face=-.15)),
    "hungry": dict(D=.9, layers=dict(
        sq=k((0, S(.97, 1.05), IO), (50, S(1.01, .99), IO), (100, S(.97, 1.05))),
        lift=k((0, T(0, -3), IO), (50, T(), IO), (100, T(0, -3))),
        face=k((0, T(0, -1), IO), (50, T(0, 1), IO), (100, T(0, -1))),
        moon=k((0, T(), IO), (50, T(3, -3), IO), (100, T())),
    )),
    "chomp": dict(D=1.4, layers=dict(
        lift=k((0, T()), (8, T(0, 2)), (20, T(0, -7), EI), (32, T()), (100, T())),
        sq=k((0, S()), (8, S(1.16, .84)), (20, S(.93, 1.09)), (32, S(1.06, .95)), (44, S(.98, 1.02)), (56, S()), (100, S())),
        face=k((0, T()), (8, T(0, 3)), (20, T(0, -2)), (32, T()), (100, T())),
        sh=k((0, S()), (8, S(1.08)), (20, S(.8)), (32, S()), (100, S())),
        orb=k((0, T()), (12, T(0, 6)), (26, T(0, -5)), (38, T(0, 2)), (50, T()), (100, T())),
    )),
    "chew": dict(D=.8, layers=dict(
        sq=k((0, S(1.035, .965), IO), (50, S(.985, 1.02), IO), (100, S(1.035, .965))),
        face=k((0, T(0, 1), IO), (50, T(0, -1), IO), (100, T(0, 1))),
    )),
    "shy": dict(D=3.6, layers=dict(
        sq=k((0, S(.97) + " rotate(-3deg)", IO), (30, S(.93, .95) + " rotate(-6deg)", IO), (60, S(.94, .955) + " rotate(-5deg)", IO),
             (100, S(.97) + " rotate(-3deg)")),
        face=k((0, T(-1, 1), IO), (30, T(-3, 3), IO), (60, T(-3, 2), IO), (100, T(-1, 1))),
        moon=k((0, T(0, 12)), (24, T(0, 12), EO), (40, T(0, -4), IO), (52, T(-1, -2), IO), (62, T(0, -4), EI), (78, T(0, 12)), (100, T(0, 12))),
        x2=k((0, "opacity:.75", IO), (30, "opacity:1", IO), (100, "opacity:.75")),
    )),
}

ORIGINS = {"sq": "50% 100%", "sh": "50% 50%", "face": "50% 50%", "eyes": "50% 50%", "fl": "50% 0%", "fr": "50% 0%",
           "moon": "50% 50%", "x1": "50% 50%", "x2": "50% 50%", "lift": "50% 50%", "orb": "50% 50%"}


def _frame_css(tr):
    if ";" in tr:
        t, rest = tr.split(";", 1)
        t = t.strip()
        return (f"transform:{t};" if t and not t.startswith("opacity") else (t + ";" if t else "")) + rest
    if tr.startswith("opacity"):
        return tr
    return f"transform:{tr}"


def motion_css():
    out = []
    for mood, spec in MOTION.items():
        D = spec["D"]
        delays = spec.get("delays", {})
        for layer, frames in spec["layers"].items():
            name = f"{mood}-{layer}"
            body = []
            for f in frames:
                pct, tr = f[0], f[1]
                extra = (";" + f[2]) if len(f) > 2 else ""
                body.append(f"{pct}%{{{_frame_css(tr)}{extra}}}")
            out.append(f"@keyframes {name}{{{''.join(body)}}}")
            dl = delays.get(layer, 0)
            org = ".m-grabbed .L-sq{transform-origin:50% 0%}" if (mood == "grabbed" and layer == "sq") else ""
            out.append(f".m-{mood} .L-{layer}{{animation:{name} {D}s infinite;animation-delay:{dl}s;animation-timing-function:cubic-bezier(.45,0,.55,1)}}{org}")
        if "svg" in spec:
            frames = spec["svg"]
            body = "".join(f"{f[0]}%{{transform:{f[1]}{(';' + f[2]) if len(f) > 2 else ''}}}" for f in frames)
            out.append(f"@keyframes {mood}-svg{{{body}}}")
            org = "50% 22%" if mood == "grabbed" else "50% 88%"
            out.append(f"svg.m-{mood}{{animation:{mood}-svg {D}s infinite;transform-origin:{org}}}")
    for layer, o in ORIGINS.items():
        out.append(f".L-{layer}{{transform-box:fill-box;transform-origin:{o}}}")
    return "".join(out)


def orbit_css():
    steps = []
    for i in range(37):
        t = 2 * math.pi * i / 36
        x, y, s = RX * math.cos(t), RY * math.sin(t), 1 + 0.13 * math.sin(t)
        steps.append(f"{i*100/36:.3f}%{{transform:translate({x:.2f}px,{y:.2f}px) scale({s:.3f})}}")
    return ("@keyframes nimiOrbit{" + "".join(steps) + "}"
            "@keyframes nimiFront{0%,49.7%{opacity:1}50%,99.7%{opacity:0}100%{opacity:1}}"
            ".orb{animation:nimiOrbit 9s linear infinite;transform-box:fill-box;transform-origin:center}"
            ".orbF{animation:nimiFront 9s linear infinite}")


CSS = orbit_css() + motion_css() + """
.L-blink{animation:nBlink 6.2s infinite;transform-box:fill-box;transform-origin:center}
@keyframes nBlink{0%,30%{transform:scaleY(1)}31.5%{transform:scaleY(.06)}33%{transform:scaleY(1)}70%{transform:scaleY(1)}71.2%{transform:scaleY(.06)}72.4%{transform:scaleY(1)}73.6%{transform:scaleY(.06)}75%,100%{transform:scaleY(1)}}
.L-roll{animation:nRoll 3.2s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
@keyframes nRoll{0%,100%{transform:rotate(-12deg)}50%{transform:rotate(12deg)}}
.L-glow{animation:nGlow 2.8s ease-in-out infinite}
@keyframes nGlow{0%,100%{opacity:.35}50%{opacity:.8}}
.dashF{animation:nDashF 4s linear infinite}
.dashB{animation:nDashB 4s linear infinite}
@keyframes nDashF{to{stroke-dashoffset:24}}
@keyframes nDashB{to{stroke-dashoffset:-24}}
.zfloat{animation:nZ 3s ease-in-out infinite;transform-box:fill-box}
.twinkle{animation:nTwinkle 1.6s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
.spin{animation:nSpin 1.4s linear infinite;transform-box:fill-box;transform-origin:center}
.pring{animation:nRing 1.5s ease-out infinite;transform-box:fill-box;transform-origin:center}
.note{animation:nNote 2.4s ease-in-out infinite;transform-box:fill-box}
.dot{animation:nDot 1.2s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
@keyframes nZ{0%{transform:translate(0,6px) scale(.6);opacity:0}30%{opacity:.95}100%{transform:translate(6px,-16px) scale(1.1);opacity:0}}
@keyframes nTwinkle{0%,100%{transform:scale(.4) rotate(0deg);opacity:.25}50%{transform:scale(1.2) rotate(45deg);opacity:1}}
@keyframes nSpin{to{transform:rotate(360deg)}}
@keyframes nRing{0%{transform:scale(1);opacity:.9}100%{transform:scale(2.4);opacity:0}}
@keyframes nNote{0%{transform:translate(0,8px) rotate(-10deg) scale(.7);opacity:0}25%{opacity:1}100%{transform:translate(8px,-20px) rotate(10deg) scale(1);opacity:0}}
.L-pom{animation:nPom 1.8s ease-in-out infinite;transform-box:fill-box;transform-origin:50% 100%}@keyframes nPom{0%,100%{transform:translate(0,0) rotate(-6deg)}50%{transform:translate(1px,-2px) rotate(6deg)}}
.L-scarf{animation:nScarf 2.6s ease-in-out infinite;transform-box:fill-box;transform-origin:30% 0%}@keyframes nScarf{0%,100%{transform:rotate(-5deg)}50%{transform:rotate(7deg)}}
.munchA{animation:nMA .42s steps(1) infinite}.munchB{animation:nMB .42s steps(1) infinite}@keyframes nMA{0%{opacity:1}50%{opacity:0}}@keyframes nMB{0%{opacity:0}50%{opacity:1}}
@keyframes nDot{0%,60%,100%{transform:translateY(0);opacity:.35}30%{transform:translateY(-5px);opacity:1}}
"""


# ------------------------------------------------------------------ drawing helpers
def star(x, y, s, fill, cls="", style=""):
    c = f' class="{cls}"' if cls else ""
    st = f' style="{style}"' if style else ""
    return (f'<path{c}{st} d="M{x} {y-s} Q{x+s*.22} {y-s*.22} {x+s} {y} Q{x+s*.22} {y+s*.22} {x} {y+s} '
            f'Q{x-s*.22} {y+s*.22} {x-s} {y} Q{x-s*.22} {y-s*.22} {x} {y-s} Z" fill="{fill}"/>')


def moon_art(face="open", r=13, tint=None):
    s = r / 13
    fill = tint or MOON
    crat = CORAL_D if tint else CRATER
    o = [f'<circle cx="0" cy="0" r="{r}" fill="{fill}"/>',
         f'<circle cx="{5*s}" cy="{-5*s}" r="{2.6*s}" fill="{crat}"/>',
         f'<circle cx="{-6*s}" cy="{5*s}" r="{1.8*s}" fill="{crat}"/>',
         f'<ellipse cx="{-4.5*s}" cy="{-6.5*s}" rx="{3*s}" ry="{1.8*s}" transform="rotate(-35 {-4.5*s} {-6.5*s})" fill="#fff" opacity=".55"/>']
    w = 1.8 * s
    if face == "sleep":
        o.append(f'<path d="M{-6*s} 0 q{2.5*s} {2.5*s} {5*s} 0 M{1*s} 0 q{2.5*s} {2.5*s} {5*s} 0" stroke="{INK}" stroke-width="{w}" fill="none" stroke-linecap="round"/>')
    elif face == "happy":
        o.append(f'<path d="M{-6*s} {1*s} q{2.5*s} {-3*s} {5*s} 0 M{1*s} {1*s} q{2.5*s} {-3*s} {5*s} 0" stroke="{INK}" stroke-width="{w}" fill="none" stroke-linecap="round"/>')
    elif face == "open":
        o.append(f'<circle cx="{-3.5*s}" cy="{-.5*s}" r="{1.8*s}" fill="{INK}"/><circle cx="{3.5*s}" cy="{-.5*s}" r="{1.8*s}" fill="{INK}"/>')
    elif face == "wow":
        o.append(f'<circle cx="{-3.5*s}" cy="{-1.5*s}" r="{2*s}" fill="{INK}"/><circle cx="{3.5*s}" cy="{-1.5*s}" r="{2*s}" fill="{INK}"/><ellipse cx="0" cy="{4*s}" rx="{1.6*s}" ry="{2*s}" fill="{INK}"/>')
    elif face == "worried":
        o.append(f'<circle cx="{-3.5*s}" cy="{-1*s}" r="{1.7*s}" fill="{INK}"/><circle cx="{3.5*s}" cy="{-1*s}" r="{1.7*s}" fill="{INK}"/>'
                 f'<path d="M{-4*s} {5*s} q{2*s} {-2*s} {4*s} 0 t{4*s} 0" stroke="{INK}" stroke-width="{1.5*s}" fill="none" stroke-linecap="round"/>')
    return "".join(o)


class Rig:
    def __init__(self, anim, gid):
        self.anim = anim
        self.gid = gid

    def c(self, *names):
        if not self.anim:
            return ""
        return f' class="{" ".join(names)}"'

    def st(self, s):
        return f' style="{s}"' if (self.anim and s) else ""


def glow(r, gid, anim):
    cls = ' class="L-glow"' if anim else ' opacity=".5"'
    return f'<circle{cls} cx="0" cy="0" r="{r}" fill="url(#{gid})"/>'


def orbit_moon(rig, layer, face, dur, phase, opacity=1.0, halo=True):
    t = 2 * math.pi * phase
    x, y = RX * math.cos(t), RY * math.sin(t)
    s = 1 + 0.13 * math.sin(t)
    a = f"animation-duration:{dur}s;animation-delay:{-phase*dur:.2f}s"
    art = f'<g{rig.c("L-roll")}>{moon_art(face)}</g>'
    inner = f'<g transform="rotate({-TILT})">{glow(24, rig.gid, rig.anim) if halo else ""}{art}</g>'
    orb = f'<g{rig.c("orb")}{rig.st(a)} transform="translate({x:.1f} {y:.1f}) scale({s:.3f})">{inner}</g>'
    if layer == "front":
        vis = 1 if math.sin(t) > 0 else 0
        orb = f'<g{rig.c("orbF")}{rig.st(a)} opacity="{vis}">{orb}</g>'
    else:
        opacity = opacity * .82
    return f'<g transform="rotate({TILT} {CX} {CY})"><g transform="translate({CX} {CY})" opacity="{opacity:.2f}">{orb}</g></g>'


SAT_ART = [
    f'<rect x="-6" y="-7.5" width="12" height="15" rx="2.5" fill="{MIST}"/><rect x="-3.5" y="-2" width="7" height="1.6" rx=".8" fill="{DEEP}"/><rect x="-3.5" y="1.5" width="5" height="1.6" rx=".8" fill="{DEEP}"/>',
    f'<rect x="-6" y="-7.5" width="12" height="15" rx="2.5" fill="{ROSE}"/><circle cx="-1.5" cy="-2" r="1.8" fill="#fff"/><path d="M-4.5 4.5 l3 -3 l2 2 l2 -2 l2 3 z" fill="#fff"/>',
    f'<rect x="-6" y="-7.5" width="12" height="15" rx="2.5" fill="{MOON}"/><rect x="-1" y="-7.5" width="2" height="9" fill="{CRATER}"/><rect x="-2" y="1.5" width="4" height="3" rx="1" fill="{CRATER}"/>',
]


def orbit_item(rig, layer, art, dur, phase, opacity=1.0):
    phase = phase % 1
    t = 2 * math.pi * phase
    x, y = RX * math.cos(t), RY * math.sin(t)
    s = 1 + 0.13 * math.sin(t)
    a = f"animation-duration:{dur}s;animation-delay:{-phase*dur:.2f}s"
    inner = f'<g transform="rotate({-TILT}) scale(1.35)"><g{rig.c("L-roll")}>{art}</g></g>'
    orb = f'<g{rig.c("orb")}{rig.st(a)} transform="translate({x:.1f} {y:.1f}) scale({s:.3f})">{inner}</g>'
    if layer == "front":
        vis = 1 if math.sin(t) > 0 else 0
        orb = f'<g{rig.c("orbF")}{rig.st(a)} opacity="{vis}">{orb}</g>'
    else:
        opacity = opacity * .8
    return f'<g transform="rotate({TILT} {CX} {CY})"><g transform="translate({CX} {CY})" opacity="{opacity:.2f}">{orb}</g></g>'


def orbit_line(rig, part, style, speed):
    if style == "none":
        return ""
    col, dash = MOON, ""
    ob, of = (".35", ".9")
    if style == "faint":
        ob, of = (".12", ".28")
    if style == "error":
        col, dash, ob, of = CORAL, ' stroke-dasharray="6 9"', ".4", ".85"
    if style == "loose":
        dash, ob, of = ' stroke-dasharray="3 8"', ".2", ".4"
    rot = f'transform="rotate({TILT} {CX} {CY})"'
    sparkle = style == "normal"
    # particle speed: half the moon's speed along the path
    pdur = 24 * speed * 2 / PERIM if speed else 4
    if part == "back":
        o = f'<ellipse cx="{CX}" cy="{CY}" rx="{RX}" ry="{RY}" fill="none" stroke="{col}" stroke-width="2.5" opacity="{ob}"{dash}/>'
        if sparkle:
            o += (f'<ellipse{rig.c("dashB")}{rig.st(f"animation-duration:{pdur:.2f}s")} cx="{CX}" cy="{CY}" rx="{RX}" ry="{RY}" fill="none" '
                  f'stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="0.1 23.9" opacity=".35"/>')
        return f'<g {rot}>{o}</g>'
    d = f"M{CX-RX} {CY} A{RX} {RY} 0 0 0 {CX+RX} {CY}"
    o = f'<path d="{d}" fill="none" stroke="{col}" stroke-width="3" opacity="{of}" stroke-linecap="round"{dash}/>'
    if sparkle:
        o += (f'<path{rig.c("dashF")}{rig.st(f"animation-duration:{pdur:.2f}s")} d="{d}" fill="none" stroke="#fff" stroke-width="3" '
              f'stroke-linecap="round" stroke-dasharray="0.1 23.9" opacity=".75"/>')
    return f'<g {rot}>{o}</g>'


L, R, EY = 80, 120, 140


def eyes(kind, rig):
    """Returns (shapes, blinkable)."""
    o = []
    if kind == "star":
        for x in (L, R):
            o.append(f'<ellipse cx="{x}" cy="{EY}" rx="9" ry="11.5" fill="{INK}"/>' + star(x-2.6, EY-4.2, 4.6, "#fff")
                     + f'<circle cx="{x+3.2}" cy="{EY+4.5}" r="1.5" fill="#fff" opacity=".85"/>')
        return "".join(o), True
    if kind == "sparkle":
        for x in (L, R):
            o.append(f'<ellipse cx="{x}" cy="{EY-1}" rx="10.5" ry="13" fill="{INK}"/>'
                     + f'<g{rig.c("twinkle")}{rig.st("animation-duration:.9s")}>{star(x-2.4, EY-5, 6.2, "#fff")}</g>'
                     + star(x+4, EY+5, 2.6, "#fff") + f'<circle cx="{x-4}" cy="{EY+6}" r="1.2" fill="#fff"/>')
        return "".join(o), False
    if kind == "big":
        for x in (L, R):
            o.append(f'<ellipse cx="{x}" cy="{EY-2}" rx="10.5" ry="13.5" fill="{INK}"/><circle cx="{x-3}" cy="{EY-7}" r="3.8" fill="#fff"/>'
                     f'<circle cx="{x+3.4}" cy="{EY+3}" r="1.8" fill="#fff" opacity=".85"/>')
        return "".join(o), False
    if kind == "attention":
        for x in (L, R):
            o.append(f'<ellipse cx="{x}" cy="{EY}" rx="10" ry="12.5" fill="{INK}"/><circle cx="{x-2.8}" cy="{EY-5}" r="4.2" fill="#fff"/>'
                     f'<circle cx="{x+3.4}" cy="{EY+4}" r="2" fill="#fff"/>'
                     f'<path d="M{x-8} {EY-19} Q{x} {EY-24} {x+8} {EY-19}" stroke="{INK}" stroke-width="2.6" fill="none" stroke-linecap="round" opacity=".65"/>')
        return "".join(o), True
    if kind == "curious":
        o.append(f'<ellipse cx="{L}" cy="{EY+1}" rx="8" ry="10" fill="{INK}"/>' + star(L-1, EY-3, 4, "#fff"))
        o.append(f'<ellipse cx="{R}" cy="{EY-1}" rx="10.5" ry="13" fill="{INK}"/>' + star(R+0.5, EY-5.5, 5.4, "#fff")
                 + f'<circle cx="{R+4.5}" cy="{EY+5}" r="1.6" fill="#fff"/>')
        o.append(f'<path d="M{R-9} {EY-21} Q{R} {EY-27} {R+9} {EY-20}" stroke="{INK}" stroke-width="2.8" fill="none" stroke-linecap="round" opacity=".7"/>')
        return "".join(o), True
    if kind == "focus":
        for x in (L, R):
            o.append(f'<ellipse cx="{x+1.5}" cy="{EY+2}" rx="8.5" ry="7.5" fill="{INK}"/><circle cx="{x-1}" cy="{EY-0.5}" r="2.4" fill="#fff"/>')
        o.append(f'<path d="M{L-9} {EY-11} L{L+6} {EY-9.5}" stroke="{INK}" stroke-width="3" stroke-linecap="round" opacity=".6"/>'
                 f'<path d="M{R+9} {EY-11} L{R-6} {EY-9.5}" stroke="{INK}" stroke-width="3" stroke-linecap="round" opacity=".6"/>')
        return "".join(o), True
    if kind == "worried":
        for x in (L, R):
            o.append(f'<ellipse cx="{x}" cy="{EY+1}" rx="7.5" ry="9.5" fill="{INK}"/><circle cx="{x-2}" cy="{EY-2.5}" r="2.6" fill="#fff"/>'
                     f'<circle cx="{x+2.4}" cy="{EY+4}" r="1.2" fill="#fff"/>')
        o.append(f'<path d="M{L-9} {EY-11} L{L+6} {EY-17}" stroke="{INK}" stroke-width="3" stroke-linecap="round" opacity=".7"/>'
                 f'<path d="M{R+9} {EY-11} L{R-6} {EY-17}" stroke="{INK}" stroke-width="3" stroke-linecap="round" opacity=".7"/>')
        return "".join(o), True
    if kind == "bored":
        for x in (L, R):
            o.append(f'<ellipse cx="{x+2.5}" cy="{EY+1}" rx="8.5" ry="10.5" fill="{INK}"/>'
                     f'<rect x="{x-9}" y="{EY-12}" width="22" height="11" fill="{BODY}"/>'
                     f'<path d="M{x-8} {EY-1} L{x+12} {EY-1}" stroke="{INK}" stroke-width="2.8" stroke-linecap="round"/>'
                     f'<circle cx="{x+1}" cy="{EY+3}" r="2" fill="#fff"/>')
        return "".join(o), True
    if kind in ("happy", "music"):
        w = "4.2" if kind == "happy" else "3.6"
        for x in (L, R):
            o.append(f'<path d="M{x-8.5} {EY+3} Q{x} {EY-10} {x+8.5} {EY+3}" fill="none" stroke="{INK}" stroke-width="{w}" stroke-linecap="round"/>')
        return "".join(o), False
    if kind == "closed":
        for x in (L, R):
            o.append(f'<path d="M{x-8.5} {EY} Q{x} {EY+8} {x+8.5} {EY}" fill="none" stroke="{INK}" stroke-width="4" stroke-linecap="round"/>')
        return "".join(o), False
    if kind == "squeeze":
        o.append(f'<path d="M{L-7} {EY-7} L{L+5} {EY} L{L-7} {EY+7}" fill="none" stroke="{INK}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>')
        o.append(f'<path d="M{R+7} {EY-7} L{R-5} {EY} L{R+7} {EY+7}" fill="none" stroke="{INK}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>')
        return "".join(o), False
    if kind == "spiral":
        for x in (L, R):
            d = (f"M{x} {EY} m-1 0 a1.5 1.5 0 1 1 3 0 a3 3 0 1 1 -6 0 a4.5 4.5 0 1 1 9 0 "
                 f"a6 6 0 1 1 -12 0 a7.5 7.5 0 1 1 15 0")
            o.append(f'<g{rig.c("spin")}><path d="{d}" fill="none" stroke="{INK}" stroke-width="2.6" stroke-linecap="round"/></g>')
        return "".join(o), False
    if kind == "shy":
        for x in (L, R):
            o.append(f'<ellipse cx="{x-3}" cy="{EY+4}" rx="6.5" ry="8" fill="{INK}"/><circle cx="{x-5}" cy="{EY+1.5}" r="2.2" fill="#fff"/>')
        return "".join(o), True
    return "", False


MX, MY = 100, 160


def mouth(kind, rig=None):
    x, y = MX, MY
    if kind == "munch":
        a = f'<path d="M{x-6} {y+1} q3 3 6 0 t6 0" fill="none" stroke="{INK}" stroke-width="3" stroke-linecap="round"/>'
        b = f'<ellipse cx="{x}" cy="{y+2}" rx="4.5" ry="3.6" fill="{MOUTH}"/>'
        if rig and rig.anim:
            return f'<g class="munchA">{a}</g><g class="munchB">{b}</g>'
        return a
    m = {
        "smile": f'<path d="M{x-5} {y} Q{x} {y+5} {x+5} {y}" fill="none" stroke="{INK}" stroke-width="3" stroke-linecap="round"/>',
        "open": f'<path d="M{x-9} {y-2} Q{x} {y+13} {x+9} {y-2} Z" fill="{MOUTH}"/><ellipse cx="{x}" cy="{y+5.5}" rx="4.5" ry="2.6" fill="{TONGUE}"/>',
        "big": f'<path d="M{x-12} {y-3} Q{x} {y+18} {x+12} {y-3} Z" fill="{MOUTH}"/><ellipse cx="{x}" cy="{y+8}" rx="6" ry="3.2" fill="{TONGUE}"/>',
        "o": f'<ellipse cx="{x}" cy="{y+1}" rx="3.2" ry="2.6" fill="{MOUTH}"/>',
        "side-o": f'<ellipse cx="{x+5}" cy="{y+1}" rx="3.4" ry="3.8" fill="{MOUTH}"/>',
        "O": f'<ellipse cx="{x}" cy="{y+2}" rx="5.2" ry="6.8" fill="{MOUTH}"/>',
        "side": f'<path d="M{x-4} {y+1} Q{x+1} {y+4} {x+6} {y-1}" fill="none" stroke="{INK}" stroke-width="3" stroke-linecap="round"/>',
        "wavy": f'<path d="M{x-8} {y+2} q2 -3 4 0 t4 0 t4 0 t4 0" fill="none" stroke="{INK}" stroke-width="3" stroke-linecap="round"/>',
        "sing": f'<ellipse cx="{x}" cy="{y+2}" rx="4.2" ry="4.6" fill="{MOUTH}"/><ellipse cx="{x}" cy="{y+4.2}" rx="2.4" ry="1.4" fill="{TONGUE}"/>',
        "small-open": f'<path d="M{x-6} {y-1} Q{x} {y+9} {x+6} {y-1} Z" fill="{MOUTH}"/>',
        "flat": f'<path d="M{x-4} {y+2} L{x+7} {y+1}" stroke="{INK}" stroke-width="3" stroke-linecap="round"/>',
        "grab": f'<ellipse cx="{x}" cy="{y+2}" rx="4" ry="5" fill="{MOUTH}"/>',
        "shy": f'<path d="M{x-6} {y+3} q2 -2 4 0 t4 0" fill="none" stroke="{INK}" stroke-width="2.6" stroke-linecap="round"/>',
        "wide": f'<ellipse cx="{x}" cy="{y+3}" rx="11" ry="12" fill="{MOUTH}"/><ellipse cx="{x}" cy="{y+10}" rx="6.5" ry="3.6" fill="{TONGUE}"/>',
        "puff": (f'<circle cx="38" cy="160" r="17" fill="{BODY}"/><circle cx="162" cy="160" r="17" fill="{BODY}"/>'
                 f'<ellipse cx="42" cy="163" rx="9" ry="5" fill="{ROSE}" opacity=".85"/><ellipse cx="158" cy="163" rx="9" ry="5" fill="{ROSE}" opacity=".85"/>'
                 f'<path d="M{x-6} {y+1} Q{x} {y+4} {x+6} {y+1}" fill="none" stroke="{INK}" stroke-width="3" stroke-linecap="round"/>'),
    }
    return m.get(kind, "")


def blush(level):
    op = {"soft": ".5", "warm": ".8", "faint": ".3", "hot": ".95"}[level]
    o = (f'<ellipse cx="{L-14}" cy="{EY+13}" rx="8.5" ry="4.8" fill="{ROSE}" opacity="{op}"/>'
         f'<ellipse cx="{R+14}" cy="{EY+13}" rx="8.5" ry="4.8" fill="{ROSE}" opacity="{op}"/>')
    if level == "hot":
        for bx in (L - 14, R + 14):
            o += (f'<path d="M{bx-5} {EY+16} l3 -5 M{bx} {EY+16} l3 -5 M{bx+5} {EY+16} l3 -5" '
                  f'stroke="#F27FA0" stroke-width="1.6" stroke-linecap="round"/>')
    return o


def note(x, y, fill, rig, delay):
    return (f'<g{rig.c("note")}{rig.st(f"animation-delay:{delay}s")}><ellipse cx="{x}" cy="{y}" rx="5" ry="4" transform="rotate(-20 {x} {y})" fill="{fill}"/>'
            f'<path d="M{x+4.5} {y-1} L{x+4.5} {y-17} Q{x+11} {y-14} {x+11} {y-8}" stroke="{fill}" stroke-width="2.4" fill="none" stroke-linecap="round"/></g>')


MOODS = {
    "idle": dict(e="star", m="smile", b="soft", moon=("orbit", "sleep", 9, .12), o="normal"),
    "sleeping": dict(e="closed", m="o", b="soft", moon=("head", "sleep", 112, 59), o="faint"),
    "happy": dict(e="happy", m="open", b="warm", moon=("orbit", "happy", 4.5, .15), o="normal"),
    "curious": dict(e="curious", m="side-o", b="soft", moon=("static", "open", 168, 108, "front"), o="normal"),
    "surprised": dict(e="big", m="O", b="soft", moon=("static", "wow", 190, 54, "front"), o="loose"),
    "excited": dict(e="sparkle", m="big", b="warm", moon=("orbit", "happy", 2.2, .1), o="normal"),
    "working": dict(e="focus", m="side", b="faint", moon=("orbit", "open", 1.3, .2), o="normal"),
    "error": dict(e="worried", m="wavy", b="faint", moon=("static", "worried", 38, 200, "front"), o="error"),
    "music": dict(e="music", m="sing", b="warm", moon=("orbit", "happy", 2.4, .1), o="normal"),
    "attention": dict(e="attention", m="small-open", b="soft", moon=("static", "wow", 176, 100, "front"), o="normal"),
    "bored": dict(e="bored", m="flat", b="faint", moon=("orbit", "sleep", 16, .46), o="normal"),
    "grabbed": dict(e="squeeze", m="grab", b="warm", moon=("static", "wow", 30, 86, "front"), o="none"),
    "dizzy": dict(e="spiral", m="wavy", b="soft", moon=("orbit", "worried", 1.5, .05), o="loose"),
    "shy": dict(e="shy", m="shy", b="hot", moon=("static", "open", 150, 90, "back"), o="normal"),
    "hungry": dict(e="sparkle", m="wide", b="warm", moon=("static", "wow", 188, 98, "front"), o="loose"),
    "chomp": dict(e="happy", m="puff", b="warm", moon=("orbit", "wow", 3, .15), o="normal"),
    "chew": dict(e="music", m="munch", b="warm", moon=("orbit", "happy", 1.5, .1), o="normal"),
}


SCARF, SCARF_D, SCARF_S = "#FF9DB5", "#F07F9C", "#FFE7A0"


def scarf(rig):
    """Knitted winter scarf wrapped under NIMI's mouth, with a swaying tail."""
    band = "M36 167 Q100 183 164 167 L160 186 Q100 203 40 186 Z"
    tail = (f'<g transform="translate(126 182)"><g{rig.c("L-scarf")}>'
            f'<path d="M0 0 L20 0 L25 33 L5 35 Z" fill="{SCARF_D}"/>'
            f'<path d="M2.2 11 L21.6 10.4 M3.6 21 L23 20.4" stroke="{SCARF_S}" stroke-width="3" stroke-linecap="round"/>'
            f'<path d="M7 35 v6 M12 34.6 v6 M17 34.2 v6 M22 33.8 v6" stroke="{SCARF_D}" stroke-width="2.4" stroke-linecap="round"/>'
            f'</g></g>')
    knit = "".join(f'<path d="M{x} {170 + 14*(1-((x-100)/64)**2)*0.0 + (183-167)*(1-((x-100)/64)**2)*0.0:.1f}" />' for x in ())
    return (f'<path d="M40 186 Q100 203 160 186 L158 191 Q100 208 42 191 Z" fill="{INK}" opacity=".12"/>'
            f'<path d="{band}" fill="{SCARF}"/>'
            f'<path d="M38 175 Q100 191 162 175" fill="none" stroke="{SCARF_S}" stroke-width="3.2" stroke-linecap="round"/>'
            + "".join(f'<path d="M{x} {y} l2 4 l2 -4" fill="none" stroke="{SCARF_D}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" opacity=".7"/>'
                      for x, y in ((56, 181), (72, 185), (88, 187.5), (104, 188), (120, 186.5), (136, 184), (150, 180)))
            + f'<ellipse cx="128" cy="183" rx="11" ry="8" fill="{SCARF_D}"/>'
            + tail)


def beanie(rig):
    """Knitted winter hat with a fluffy pom-pom."""
    dome = f'<path d="M44 100 C40 46 160 46 156 100 Z" fill="{SCARF}"/>'
    shade = f'<path d="M60 64 C80 52 120 52 140 64" fill="none" stroke="{SCARF_D}" stroke-width="3" stroke-linecap="round" opacity=".55"/>'
    stripe = f'<path d="M47 80 Q100 64 153 80" fill="none" stroke="{SCARF_S}" stroke-width="4" stroke-linecap="round"/>'
    cuff = f'<path d="M38 94 Q100 80 162 94 L161 110 Q100 96 39 110 Z" fill="{SCARF_D}"/>'
    ribs = "".join(f'<path d="M{x} {95 - 13*(1-((x-100)/62)**2):.1f} v13" stroke="{SCARF}" stroke-width="2.2" stroke-linecap="round" opacity=".55"/>' for x in range(48, 156, 9))
    puffs = "".join(f'<circle cx="{100 + 9*math.cos(a):.1f}" cy="{44 + 9*math.sin(a):.1f}" r="6" fill="#F7F8FF"/>' for a in [i * math.pi / 4 for i in range(8)])
    pom = (f'<g transform="translate(0 0)"><g{rig.c("L-pom")}>{puffs}<circle cx="100" cy="44" r="10" fill="#FFFFFF"/>'
           f'<circle cx="96" cy="40" r="3" fill="#fff" opacity=".9"/></g></g>')
    return dome + shade + stripe + cuff + ribs + pom


def static_moon(rig, face, x, y, tint=None, halo=False):
    h = glow(22, rig.gid, rig.anim) if halo else ""
    return f'<g transform="translate({x} {y})"><g{rig.c("L-moon")}>{h}<g{rig.c("L-roll")}>{moon_art(face, 13, tint)}</g></g></g>'


def nimi(mood="idle", size=220, anim=True, delay=0.0, sil=None, sats=0, volume=None, belly=False, winter=False):
    cfg = MOODS[mood]
    gid = f"mg{next(_ids)}"
    rig = Rig(anim, gid)
    if sil:
        inner = (f'<g transform="rotate({TILT} {CX} {CY})"><ellipse cx="{CX}" cy="{CY}" rx="{RX}" ry="{RY}" fill="none" stroke="{sil}" stroke-width="2.5"/></g>'
                 + f'<ellipse cx="82" cy="204" rx="12" ry="6.5" fill="{sil}"/><ellipse cx="118" cy="204" rx="12" ry="6.5" fill="{sil}"/>'
                 + f'<path d="{BODY_D}" fill="{sil}"/>'
                 + f'<g transform="translate(176 140)"><circle r="13" fill="{sil}"/></g>')
        return _svg(inner, size, "NIMI silhouette", "")
    mm = cfg["moon"]
    speed = mm[2] if mm[0] == "orbit" else 9
    tint = CORAL if mood == "error" else None
    lifted = mood == "grabbed"
    defs = (f'<defs><radialGradient id="{gid}"><stop offset="0" stop-color="{MOON}" stop-opacity=".55"/>'
            f'<stop offset="1" stop-color="{MOON}" stop-opacity="0"/></radialGradient></defs>')
    o = [defs]
    # shadow (stays on the ground)
    o.append(f'<g transform="translate(100 226)"><g{rig.c("L-sh")}><ellipse cx="0" cy="0" rx="{26 if lifted else 40}" ry="{3.5 if lifted else 5}" '
             f'fill="{BODY}" opacity="{.08 if lifted else .18}"/></g></g>')
    o.append(f'<g{rig.c("L-lift")}>')
    # --- back orbit (lags behind the body)
    back = [orbit_line(rig, "back", cfg["o"], speed)]
    if mm[0] == "orbit":
        _, face, dur, ph = mm
        back.append(orbit_moon(rig, "back", face, dur, ph))
        if mood == "working":
            back.append(orbit_moon(rig, "back", face, dur, ph - .035, .35, False))
            back.append(orbit_moon(rig, "back", face, dur, ph - .07, .15, False))
    elif mm[0] == "static" and mm[4] == "back":
        back.append(static_moon(rig, mm[1], mm[2], mm[3]))
    for i in range(sats):
        back.append(orbit_item(rig, "back", SAT_ART[i % len(SAT_ART)], speed * 1.0, (mm[3] if mm[0] == "orbit" else .1) + (i + 1) / (sats + 1)))
    o.append(f'<g{rig.c("L-orb")}>{"".join(back)}</g>')
    # --- body (squash & stretch from the feet)
    o.append(f'<g{rig.c("L-sq")}>')
    fy = 210 if lifted else 204
    o.append(f'<g{rig.c("L-fl")}><ellipse cx="82" cy="{fy}" rx="12" ry="6.5" fill="{DEEP}"/></g>'
             f'<g{rig.c("L-fr")}><ellipse cx="118" cy="{fy}" rx="12" ry="6.5" fill="{DEEP}"/></g>')
    o.append(f'<path d="{BODY_D}" fill="{BODY}"/>')
    o.append('<ellipse cx="74" cy="104" rx="11" ry="16" transform="rotate(38 74 104)" fill="#fff" opacity=".35"/>')
    o.append(f'<ellipse cx="100" cy="180" rx="38" ry="18" fill="{MIST}" opacity=".7"/>')
    # face
    e_shapes, blinkable = eyes(cfg["e"], rig)
    if blinkable and anim:
        bd = 5.4 + (delay * 1.37) % 2.4
        e_shapes = f'<g class="L-blink" style="animation-duration:{bd:.2f}s;animation-delay:{-delay*1.9:.2f}s">{e_shapes}</g>'
    o.append(f'<g{rig.c("L-face")}>')
    o.append(f'<g{rig.c("L-x2") if mood == "shy" else ""}>{blush(cfg["b"])}</g>')
    o.append(star(58, 156, 4.5, MOON) + star(142, 156, 4.5, MOON))
    o.append(f'<g{rig.c("L-eyes")}>{e_shapes}</g>')
    o.append(mouth(cfg["m"], rig))
    o.append('</g>')
    if winter:
        o.append(scarf(rig))
        o.append(beanie(rig))
    if belly:
        o.append(f'<g opacity=".55"><path d="M92 170 h12 l5 5 v14 h-17 z" fill="{DEEP}"/><path d="M104 170 v5 h5" fill="none" stroke="{MIST}" stroke-width="1.2"/></g>')
    if mm[0] == "head":
        hx, hy = (138, 50) if winter else (mm[2], mm[3])
        o.append(static_moon(rig, mm[1], hx, hy, halo=True))
    o.append('</g>')  # /L-sq
    # --- front orbit
    front = [orbit_line(rig, "front", cfg["o"], speed)]
    if mm[0] == "orbit":
        front.append(orbit_moon(rig, "front", face, dur, ph))
        if mood == "working":
            front.append(orbit_moon(rig, "front", face, dur, ph - .035, .35, False))
            front.append(orbit_moon(rig, "front", face, dur, ph - .07, .15, False))
    for i in range(sats):
        front.append(orbit_item(rig, "front", SAT_ART[i % len(SAT_ART)], speed * 1.0, (mm[3] if mm[0] == "orbit" else .1) + (i + 1) / (sats + 1)))
    if volume is not None:
        half = PERIM / 2
        front.append(f'<g transform="rotate({TILT} {CX} {CY})"><path d="M{CX-RX} {CY} A{RX} {RY} 0 0 0 {CX+RX} {CY}" fill="none" '
                     f'stroke="{MOON}" stroke-width="6" stroke-linecap="round" stroke-dasharray="{volume*half:.1f} {half:.1f}"/></g>')
    o.append(f'<g{rig.c("L-orb")}>{"".join(front)}</g>')
    if mm[0] == "static" and mm[4] == "front":
        if mood == "attention":
            for dl in (0, -.75):
                rc = f' class="pring" style="animation-delay:{dl}s"' if anim else ' opacity=".5"'
                o.append(f'<g transform="translate({mm[2]} {mm[3]})"><circle{rc} r="14" fill="none" stroke="{MOON}" stroke-width="2"/></g>')
        o.append(static_moon(rig, mm[1], mm[2], mm[3], tint, halo=(mood == "attention")))
    # --- extras
    if mood == "sleeping":
        for (x, y, fs, dl, op) in ((140, 74, 20, 0, 1), (154, 60, 15, -1, .8), (166, 48, 11, -2, .6)):
            o.append(f'<text{rig.c("zfloat")}{rig.st(f"animation-delay:{dl}s")} x="{x}" y="{y}" font-family="Rubik, sans-serif" '
                     f'font-weight="700" font-size="{fs}" fill="{MIST}" opacity="{op}">z</text>')
    if mood == "curious":
        o.append(f'<g transform="translate(152 66)"><g{rig.c("L-x1")}><text x="-6" y="8" font-family="Rubik, sans-serif" font-weight="700" font-size="24" fill="{MOON}">?</text></g></g>')
    if mood == "surprised":
        o.append(f'<g{rig.c("L-x1")}><path d="M70 62 L64 52 M100 56 L100 44 M130 62 L136 52" stroke="#fff" stroke-width="3" stroke-linecap="round"/></g>')
    if mood == "excited":
        for (sx, sy, ss, dl) in ((26, 82, 6, 0), (178, 74, 5, -.5), (186, 176, 4, -1), (18, 160, 3.5, -.8), (100, 52, 4, -.3)):
            o.append(star(sx, sy, ss, "#fff", "twinkle" if anim else "", f"animation-delay:{dl}s" if anim else ""))
    if mood == "working":
        for i, dx in enumerate((0, 10, 20)):
            o.append(f'<circle{rig.c("dot")}{rig.st(f"animation-delay:{i*0.18:.2f}s")} cx="{136+dx}" cy="66" r="3.2" fill="{MIST}"/>')
    if mood == "error":
        o.append(f'<g transform="translate(160 80)"><g{rig.c("L-x1")}><circle r="11" fill="{CORAL}"/><rect x="-1.6" y="-7.5" width="3.2" height="9" rx="1.6" fill="#fff"/><circle cy="6" r="1.8" fill="#fff"/></g></g>')
        o.append(f'<g{rig.c("L-x2")}><path d="M52 98 Q58 108 52 113 Q46 108 52 98 Z" fill="#A9E4FF"/></g>')
    if mood == "music":
        o.append(note(150, 76, MOON, rig, 0))
        o.append(note(36, 92, ROSE, rig, -1.2))
        o.append(note(168, 112, ROSE, rig, -.6))
    if mood == "bored":
        o.append(f'<g{rig.c("L-x1")}><circle cx="114" cy="164" r="3" fill="{MIST}" opacity=".7"/><circle cx="122" cy="161" r="4.5" fill="{MIST}" opacity=".5"/></g>')
    if mood == "dizzy":
        st_ = "".join(star(30 * math.cos(a), 30 * math.sin(a), 5, MOON) for a in (0, math.pi/2, math.pi, 3*math.pi/2))
        o.append(f'<g transform="translate(100 62) scale(1 .32)"><g{rig.c("spin")}>{st_}</g></g>')
    if mood == "grabbed":
        o.append(f'<path d="M100 72 L100 30" stroke="{MIST}" stroke-width="2" stroke-dasharray="3 5" opacity=".5"/>')
    o.append('</g>')  # /L-lift
    cls = f"m-{mood}" if anim else ""
    return _svg("".join(o), size, f"NIMI — {mood}", cls)


def _svg(inner, size, label, cls):
    c = f' class="{cls}"' if cls else ""
    return (f'<svg{c} width="{size}" height="{size}" viewBox="{VB}" role="img" aria-label="{label}" '
            f'xmlns="http://www.w3.org/2000/svg" style="overflow: visible">{inner}</svg>')
