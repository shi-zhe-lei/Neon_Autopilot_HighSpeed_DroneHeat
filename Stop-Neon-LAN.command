#!/bin/zsh

# Use the same checkout and Node discovery as the start action.
typeset -r project_directory="${0:A:h}"
/bin/zsh "${project_directory}/server/lan-command.zsh" stop
