#!/bin/sh
# Commit + push en une seule commande.
# Usage : ./push.sh "message du commit"   (sans message : « Mise à jour du site »)
set -e
cd "$(dirname "$0")"

msg="${*:-Mise à jour du site}"

git add -A
if git diff --cached --quiet; then
  echo "Rien de nouveau à commiter."
else
  git commit -m "$msg"
fi
git push
