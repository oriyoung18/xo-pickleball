XO Pickleball profile/leaderboard repair

Upload these three files to the ROOT of the GitHub xo-pickleball repository:
- index.html
- app.js
- styles.css

Replace the existing files and commit directly to main.

Do NOT replace config.js.
No Supabase SQL is needed.

After Netlify publishes:
1. Open https://xopickleball.com
2. Hard refresh (Cmd+Shift+R on Mac)
3. The status should say Live, not Connecting.
4. Player count should reflect the database, not the 40-player placeholder.
Branch preview enabled.
