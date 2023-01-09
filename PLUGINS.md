# Plugins
Volcano has support for plugins developers can use to add functionality similar to LavaLink. The functionality plugins can offer are a little limited, but the API will expand in the future. Should your plugin require special functionality, please open an issue and I can see on expanding on the API.

## Installing plugins
Volcano comes with a cli during the runtime to install plugins. You can type `installplugin <raw link to package.json>`
do not include the <>. If installing from GitHub, make sure it points to the raw file instead of the pretty view GitHub gives you since it expects to be JSON formatted.
If the file path isn't ending with package.json, then Volcano will refuse to load it. Volcano requires the main field to have a file. Volcano will only download the main file and nothing else.

Should you update or do a clean install and need to reinstall all of the plugins, you can type `reinstallall` and it'll work with what's installed in the plugin-manifest.json

## Plugins Volcano supports currently
- Spotify (built in) by PapiOphidian (that's me!)
- [Apple Music by PapiOphidian](https://github.com/AmandaDiscord/VolcanoPlugins/tree/main/AppleMusic)
- [Deezer by PapiOphidian](https://github.com/AmandaDiscord/VolcanoPlugins/tree/main/Deezer)
- [Newgrounds by PapiOphidian](https://github.com/AmandaDiscord/VolcanoPlugins/tree/main/Newgrounds)
- [Twitter by PapiOphidian](https://github.com/AmandaDiscord/VolcanoPlugins/tree/main/Twitter)

## Contributing
If you'd like to add your own plugin here for discoverability, you may do so with a PR or issue. I'll be checking code quality, so nothing malicious >:(
