![Volcano's icon, a cartoon style volcano eruption with the text "volcano".](./images/volcano-icon.png)

Volcano is a (Mostly) LavaLink compatible replacement which is written in TypeScript for the Node JS runtime.

# Why not just use LavaLink
LavaLink make memory usage go brrrrr. Volcano is very lightweight. Dependencies have been carefully chosen with a tendency towards a lower level approach as compared to installing a collection of high level and bloated libs, wrapping it in a web server whilst breaking protocols and calling it a day. I have also had my fair share of troubleshooting and fixing memory leaks and I've done my best to not include those as a "feature". Yw. If you find a flaw in my logic, please open an issue or a PR and we'll sort things out.

Volcano makes a *best effort* towards mirroring LavaLink's protocols ~~which was actually very difficult to do granted not much info is out there regarding specific cases of LavaLink's protocols~~ while trying to efficiently memory manage and make use of a thread pool based on worker_threads for reliable and smooth playback.

# Non-compatible changes
Volcano offers an op ffmpeg. **OP FFMPEG DOES NOT EXIST IN LAVALINK AS LAVALINK DOES NOT USE FFMPEG. DO NOT TRY TO GET SUPPORT FOR OP FFMPEG IN LAVALINK'S SERVER**. Op ffmpeg accepts an Array of raw ffmpeg args. op ffmpeg overrides op filters and op seek.

Example:
```js
{
	"op": "ffmpeg",
	"guildId": "497159726455455754",
	"args": ["aresample=48000,asetrate=48000*0.7,atempo=1.3,aresample=48000"]
}
```

Volcano appends a "Is-Volcano" header in the handshake. The value should be equal to "true" always if using Volcano.

# Some Caveats
Volcano only supports YouTube, Soundcloud, http, and local files currently. Any other sources will not work. If you really want them to work with Volcano, please open a PR. I am more than happy to add features.
Volcano does not support all filter op properties. LavaLink's filters do not clearly translate logically to ffmpeg arguments (to me at least. I am nub plz no booly)

# Usage
git clone the repo or just download the code as a zip and push it to prod :pain:

Starting it could be done by cding into the Volcano folder and then typing `node .` or starting the dist/index.js file. The package.json links to the index in the dist folder.
Be careful with what current working directory you end up using because Volcano will try to read your application.yml config file based on the cwd (the exact behavior of LavaLink)

# Requirements
Node 16 or above.
FFMPEG will default to using what's installed on the machine and added to path before falling back to avconf and then using the binaries installed by ffmpeg-static.
FFMPEG in path is preferable as it will almost always provide better performance depending on how you built it.

# Performance
Test Machine: 4 VCores, 8GB VALLOC memory, 200GB SSD. Running Ubuntu 20.04.2 LTS. Provided by Contabo, located in Saint Louis, Missouri.

All tests with LavaLink were conducted with Java 14 LTS (openjdk-14-jre-headless).
All tests with Volcano were conducted with Node JS 16.6.

## Boot
LavaLink using Java 14 LTS (openjdk-14-jre-headless) took approximately 3 seconds on average to reach a post ready state.
Volcano using Node JS 16.6.2 took approximately 0.35 seconds on average to reach a post ready state.

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
When getting tracks, only essential data is fetched in the form of streams. While getting track info from the HTTP source, only 50 chunks of 16KB (800KB total at max) are allowed to be piped, but it usually identifies the track before it reaches the end of the 50 chunks. After that, the stream is forcibly closed and the HTTP connection is destroyed. The biggest network and memory "hog" is YouTube tracks which has a highWaterMark of 10MB. The author of the YouTube lib insists that it doesn't always occupy that amount, but that is the theoretical max buffer size to account for network instability. Other track streaming usage sits around 2MB per track.

No assumptions are made in regards to track metadata including streams.

## CPU usage
LavaLink:
1 player without filters used 5% consistently.
Volcano:
1 player without filters used 0.3 - 1.0% leaning more towards the lower end on average.
