![Volcano's icon, a cartoon style volcano eruption with the text "volcano".](./images/volcano-icon.png)

Volcano is a (Mostly) LavaLink compatible replacement which is written in TypeScript for the Node JS runtime.

# Why not just use LavaLink
You should use LavaLink because it's an amazing modular application!
However, every piece of software has its ups and downs and I, personally, have found that LavaLink uses more memory than I feel comfortable with. Not to mistake this with a memory leak. Volcano is very lightweight. Dependencies have been carefully chosen with a tendency towards a lower level approach as compared to the very possible approach I could have taken by installing a collection of high level and bloated libs, wrapping it in a web server whilst breaking LavaLink-protocols and calling it a day. I have also had my fair share of troubleshooting and fixing memory leaks and I've done my best to not include those as a "feature" (again, not referring to LavaLink. My code *can* be *bad* no meme). If you find a flaw in my logic, please open an issue or a PR and we'll sort things out.

Volcano makes a *best effort* towards mirroring LavaLink's protocols ~~which was actually very difficult to do granted not much info is out there regarding specific cases of LavaLink's protocols~~ while trying to efficiently memory manage and make use of a thread pool based on worker_threads for reliable and smooth playback.

# Be nice
Do not be rude about LavaLink's performance or flaunt to LavaLink that this project may be more lightweight. There are trade offs with this project such as not being a perfect translations. While production ready, the caveats are to be taken into consideration. The owner of LavaLink has been very cool about all of this. As such, I do not want disdain between either side and the last thing I want is LavaLink to stop

# Compatibility
What Volcano offers that LavaLink doesn't:
- Is-Volcano handshake header

What LavaLink offers that Volcano doesn't:
- Some REST routes
- All filter op properties
- Better filtering
- Better support for SHOUTCast/ICECast
- IPV6 requesting and rotation (There have been reports that YouTube doesn't ban IPs anymore, but should be taken with a grain of salt)
- http proxying

# Plugins
Volcano supports its own plugin system like LavaLink has its own and comes with a Spotify plugin by default as support for Spotify to some degree and also for developers to look at and copy. This plugin may or may not be compatible with the Spotify plugin offered by LavaLink. Something to keep in mind is that due to how fundamentally different Volcano is from LavaLink, including being a totally different language, Volcano cannot load plugins intended to be used by LavaLink and vice versa. The scope of what Plugins can do in Volcano is also limited at the time of writing. The feature set may be expanded in the future, but this is what I was able to come up with in the limited time that I have. Plugins may have their own dependencies which you will have to install manually into your Volcano instance and re-do this for each Volcano update as the package.json may differ from update to update.

Read PLUGINS.md for more info and how to install

# Usage
Download the latest release from https://github.com/AmandaDiscord/Volcano/releases

Starting Volcano could be done by cding into the Volcano folder and then typing `npm run start` or starting the dist/index.js file. The package.json links to the index in the dist folder.
Be careful with what current working directory you end up using because Volcano will try to read your application.yml config file based on the cwd and then fallback to default options (the exact behavior of LavaLink)

# Requirements
Node 18 or above (global.fetch).
FFMPEG will default to using what's installed on the machine and added to path before falling back to avconf and then using the binaries installed by ffmpeg-static.
FFMPEG in path is preferable as it will almost always provide better performance depending on how you built it.

# Performance
Test Machine: 4 VCores, 8GB VALLOC memory, 200GB SSD. Running Ubuntu 20.04.2 LTS. Provided by Contabo, located in Saint Louis, Missouri.

All tests with LavaLink were conducted with Java 14 LTS (openjdk-14-jre-headless).
All tests with Volcano were conducted with Node JS 17.0.1.

## Boot
LavaLink using Java 14 LTS (openjdk-14-jre-headless) took approximately 3 seconds on average to reach a post ready state.
Volcano using Node JS 17.0.1 took approximately 0.35 seconds on average to reach a post ready state.

Below tests performance based on playing players in most metrics.
Tested tracks are all the same across all tests. (O:https://api-v2.soundcloud.com/media/soundcloud:tracks:401256987/1593d9da-25e1-4bdb-9449-6faad4616d52/stream/hls)

## Memory usage
LavaLink:
idle occupied 162MB stable.
1 player without filters used 200MB consistently.
Volcano:
idle occupied 15.3MB stable.
1 player without filters used 76MB consistently. (The large jump is because the worker_thread has a bit of overhead as module require cache is not shared with the main thread)

## Networking
When getting tracks, only essential data is fetched in the form of streams. The HTTP source has the possibility to take a while when dealing with live streams or for other reasons as the lib I use to parse track metadata *might* need to read until the end of the stream. I set a timeout for 10 seconds to destroy the input stream to continue. The biggest network and memory "hog" is YouTube tracks which has a highWaterMark of 10MB. The author of the YouTube lib insists that it doesn't always occupy that amount, but that is the theoretical max buffer size to account for network instability. Other track streaming usage sits around 2MB per track.

No assumptions are made in regards to track metadata including streams.

## CPU usage
LavaLink:
1 player without filters used 5% consistently.
Volcano:
1 player without filters used 0.3 - 1.0% leaning more towards the lower end on average.
