"""Effective sample size, luck bar and Deflated Sharpe Ratio, as in the note.
Standard library only (Python 3.8+). Returns are per trade: net profit / stake."""
from math import e, sqrt
from statistics import NormalDist, fmean, stdev

PHI = NormalDist()
EULER_GAMMA = 0.5772156649015329


def icc(days):
    """One-way ANOVA intraclass correlation; days = one list of returns per day."""
    days = [d for d in days if d]
    sizes = [len(d) for d in days]
    n, k = sum(sizes), len(days)
    if k < 2 or n <= k:
        return 0.0
    grand = fmean(x for d in days for x in d)
    msb = sum(len(d) * (fmean(d) - grand) ** 2 for d in days) / (k - 1)
    msw = sum((x - fmean(d)) ** 2 for d in days for x in d) / (n - k)
    n0 = (n - sum(s * s for s in sizes) / n) / (k - 1)
    den = msb + (n0 - 1) * msw
    return max(0.0, (msb - msw) / den) if den > 0 else 0.0


def kish_n_eff(sizes, rho):
    """Effective trades from the day sizes and rho+, using Kish's cluster size m."""
    n = sum(sizes)
    m = sum(s * s for s in sizes) / n
    return n / (1 + (m - 1) * max(rho, 0.0))


def luck_bar(sd_trial_sharpes, n_trials):
    """SR0: the best Sharpe expected among n_trials settings with no edge."""
    q = PHI.inv_cdf
    return sd_trial_sharpes * ((1 - EULER_GAMMA) * q(1 - 1 / n_trials)
                               + EULER_GAMMA * q(1 - 1 / (n_trials * e)))


def sharpe_shape(returns):
    """Per-trade Sharpe (n - 1), population skewness, non-excess kurtosis."""
    mu, n = fmean(returns), len(returns)
    m2, m3, m4 = (sum((x - mu) ** p for x in returns) / n for p in (2, 3, 4))
    return mu / stdev(returns), m3 / m2 ** 1.5, m4 / m2 ** 2


def dsr(sr, sr0, t, skew, kurt):
    """P(true Sharpe > SR0) with T effective trades; None means 'no answer'."""
    rad = 1 - skew * sr + (kurt - 1) / 4 * sr * sr
    if t <= 1 or rad <= 0:
        return None
    return PHI.cdf((sr - sr0) * sqrt(t - 1) / sqrt(rad))


if __name__ == "__main__":
    print(round(kish_n_eff([40] * 7, 0.05)))              # 95, as in the first table
    print(round(kish_n_eff([10] * 6 + [220], 0.05)))      # 29
    bar = luck_bar(0.05, 100)
    print(round(bar, 3), round(dsr(0.20, bar, 120, 1.5, 8), 2))  # 0.127 0.82
