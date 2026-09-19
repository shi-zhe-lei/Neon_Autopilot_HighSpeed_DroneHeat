#!/bin/zsh

# Resolve the copied checkout from this file before delegating machine-specific service setup.
typeset -r project_directory="${0:A:h}"
/bin/zsh "${project_directory}/server/lan-command.zsh" start
