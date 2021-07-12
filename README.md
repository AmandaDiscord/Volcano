![Volcano's icon, a cartoon style volcano eruption with the text "volcano".](./images/volcano-icon.png)

Volcano is a (Mostly) LavaLink compatible replacement which is written in TypeScript for the Node JS runtime.

# Why not just use LavaLink
LavaLink make memory usage go brrrrr. Volcano is very lightweight. Dependencies have been carefully chosen with a tendency towards a lower level approach as compared to installing a collection of high level and bloated libs, wrapping it in a web server whilst breaking protocols and calling it a day. I have also had my fair share of troubleshooting and fixing memory leaks and I've done my best to not include those as a "feature". Yw. If you find a flaw in my logic, please open an issue or a PR and we'll sort things out.

Volcano makes a *best effort* towards mirroring LavaLink's protocols ~~which was actually very difficult to do granted not much info is out there regarding specific cases of LavaLink's protocols~~ while trying to efficiently memory manage and make use of a thread pool based on worker_threads for reliable and smooth playback.

# Some Caveats
Volcano only supports YouTube, Soundcloud, and http currently. Any other sources will not work. If you really want them to work with Volcano, please open a PR. I am more than happy to add features.
Volcano does not support all filter op properties. LavaLink's filters do not clearly translate logically to ffmpeg arguments (to me at least. I am nub plz no booly)

# Usage
git clone the repo or just download the code as a zip and push it to prod :pain:

Starting it could be done by cding into the Volcano folder and then typing `node .` or starting the dist/index.js file. The package.json links to the index in the dist folder.
Be careful with what current working directory you end up using because Volcano will try to read your application.yml config file based on the cwd (the exact behavior of LavaLink)

# Requirements
Node 12 or above. Could probably go lower??? My dev machine is on 12 and everything works fine.
FFMPEG will default to using what's installed on the machine and added to path before falling back to avconf and then using the binaries installed by ffmpeg-static.
FFMPEG in path is preferable as it will almost always provide better performance depending on how you built it.

# Performance
Test Machine: 4 VCores, 8GB VALLOC memory, 200GB SSD. Running Ubuntu 20.04.2 LTS. Provided by Contabo, located in Saint Louis, Missouri.

All tests with LavaLink were conducted with Java 14 LTS (openjdk-14-jre-headless).
All tests with Volcano were conducted with Node JS 14.17.0
## Boot
LavaLink using Java 14 LTS (openjdk-14-jre-headless) took approximately 3 seconds on average to reach a post ready state.
Volcano using Node JS 14.17.0 took approximately 0.35 seconds on average to reach a post ready state.

Below tests performance based on playing players in most metrics.
Tested tracks are all the same across all tests. (O:https://api-v2.soundcloud.com/media/soundcloud:tracks:401256987/1593d9da-25e1-4bdb-9449-6faad4616d52/stream/hls)

## Memory usage
LavaLink:
idle occupied 162MB stable.
1 player without filters used 200MB consistently.
Volcano:
idle occupied 15.3MB stable.
1 player without filters used 76MB consistently.

## Networking
I don't have a consistent way to measure networking in either scenario, however, I can describe that while getting tracks from any source, only essential data is fetched in the form of streams. This keeps possible bandwidth waste low and memory usage lower. Currently in Volcano while getting track info from the HTTP source, only 20 chunks of 16KB (320KB total) are allowed to be piped. After that, the stream is forcibly closed and the HTTP connection is destroyed. This limit is more than sufficient to allow for the stream to have key metadata properties identified such as track duration and possible author/track name in some encodings which support metadata embedding such as opus.

No assumptions are made in regards to track metadata including streams.

## CPU usage
LavaLink:
1 player without filters used 5% consistently.
Volcano:
1 player without filters used 0.3 - 1.0% leaning more towards the lower end on average.
