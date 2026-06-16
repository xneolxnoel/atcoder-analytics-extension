# AtCoder Analytics

This is the public repo for the **AtCoder Analytics** Chrome extension.

- Chrome Web Store: https://chromewebstore.google.com/detail/atcoder-analytics/bmfjngielhkffoekjpdgpedpmelhabhm
- GitHub: https://github.com/xneolxnoel/atcoder-analytics-extension

AtCoder Analytics enhances AtCoder user profile pages with additional statistics:

- Solved-by-difficulty histogram (estimated difficulty)
- Solved breakdown by contest series (ABC/ARC/AGC/AHC/etc.)
- Unsolved list (attempted problems without AC), with links

Data is fetched from public endpoints and processed locally in your browser. The extension stores a small local cache to reduce repeated requests.

## Install (unpacked)

1. Open **chrome://extensions**
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder (`atcoder-analytics`)
5. Go to any profile page like `https://atcoder.jp/users/tourist`

## Notes

- Data source: AtCoder Problems API (kenkoooo). Please avoid excessive refreshes.
- Caching:
  - difficulty models cached ~24h
  - submissions cached ~10m and updated incrementally
- Difficulty display is clamped to **>= 0**.

## Debug tips

- Click **Refresh** to re-fetch if cache is old.
- Hold **Shift** while clicking **Refresh** to ignore cached submissions (forces full refresh).
