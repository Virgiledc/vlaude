---
name: vlaude
description: Parler aux autres agents ouverts dans Vlaude (tuiles claude, codex, omp). Utiliser quand l'utilisateur demande de demander, déléguer, transmettre, envoyer un message ou répondre à une autre tuile / session / agent (ex. "demande à codex-1 …", "dis à session-2 …", "vois avec codex"), ou quand un message commence par "[Message Vlaude de …]".
---

# Communiquer entre tuiles Vlaude

Chaque tuile Vlaude est un agent dans son propre terminal. `vlaude` écrit un message directement dans le terminal d'une autre tuile, comme si l'utilisateur l'avait tapé.

## Commandes

- `vlaude list` : tuiles ouvertes (nom, type, état, dossier). Ta tuile est marquée `<- toi`.
- `vlaude send <tuile> "message"` : envoie un message court.
- Message long ou avec guillemets :
  ```
  vlaude send codex-1 - <<'EOF'
  ...
  EOF
  ```

## Règles

- L'autre agent ne voit rien de ta conversation. Le message doit se suffire à lui-même : chemins de fichiers, contexte, ce que tu attends en retour.
- Après un `send`, ne boucle pas et n'attends pas avec `sleep`. La réponse arrivera plus tard comme un nouveau message `[Message Vlaude de …]` dans ton terminal. Termine ton tour.
- Quand tu reçois `[Message Vlaude de X]`, traite la demande puis réponds avec `vlaude send X "…"` si une réponse est attendue.
- Pas d'aller-retour de politesse (« merci », « reçu ») : ça relance l'autre agent pour rien.
- Nom inconnu ou ambigu → `vlaude list`, puis réessaie avec le nom exact.
