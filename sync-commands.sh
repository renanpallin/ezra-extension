#!/usr/bin/env bash
# Sincroniza os slash commands versionados deste repo com o ~/.claude local.
#
# Os comandos (/ezra etc.) são pessoais e vivem em ~/.claude/commands/ no seu PC
# — fora do repositório-alvo. Aqui mantemos a FONTE canônica versionada em
# commands/ e fazemos symlink pra ~/.claude/commands/, então editar no repo
# reflete na hora no Claude Code e o histórico fica no git.
#
# Uso:
#   ./sync-commands.sh            # cria/atualiza os symlinks
#   ./sync-commands.sh --copy     # copia em vez de symlink (se preferir)
#
# Idempotente. Faz backup de qualquer arquivo real pré-existente (.bak).

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$REPO_DIR/commands"
DEST_DIR="$HOME/.claude/commands"
MODE="link"
[ "${1:-}" = "--copy" ] && MODE="copy"

mkdir -p "$DEST_DIR"

shopt -s nullglob
for src in "$SRC_DIR"/*.md; do
  name="$(basename "$src")"
  dest="$DEST_DIR/$name"

  # já é o symlink certo? nada a fazer
  if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$src" ]; then
    echo "ok (link)   $name"
    continue
  fi

  # arquivo/real diferente no destino → backup antes de sobrescrever
  if [ -e "$dest" ] && [ ! -L "$dest" ]; then
    cp "$dest" "$dest.bak"
    echo "backup      $name → $name.bak"
  fi

  rm -f "$dest"
  if [ "$MODE" = "copy" ]; then
    cp "$src" "$dest"
    echo "copied      $name"
  else
    ln -s "$src" "$dest"
    echo "linked      $name → $src"
  fi
done

echo "Pronto. Comandos em $DEST_DIR"
