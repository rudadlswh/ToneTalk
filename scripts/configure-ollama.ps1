# Run manually on the Windows Ollama PC. Changes user-scoped environment only.
# Quit Ollama from the taskbar first, then run this and start Ollama again.
[Environment]::SetEnvironmentVariable('OLLAMA_NUM_PARALLEL', '1', 'User')
[Environment]::SetEnvironmentVariable('OLLAMA_MAX_LOADED_MODELS', '1', 'User')
[Environment]::SetEnvironmentVariable('OLLAMA_MAX_QUEUE', '1', 'User')
Write-Output 'Saved. Restart Ollama from the Start menu to apply. Existing processes are unchanged.'
