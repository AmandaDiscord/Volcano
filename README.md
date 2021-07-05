![Volcano's icon, a cartoon style volcano eruption with the text "volcano".](./images/volcano-icon.png)

Volcano is a (Mostly) LavaLink compatible replacement which is written in TypeScript for the Node JS runtime.

# Why not just use LavaLink
LavaLink make memory usage go brrrrr. Volcano is very lightweight. Dependencies have been carefully chosen with a tendency towards a lower level approach as compared to installing a collection of high level and bloated libs, wrapping it in a web server whilst breaking protocols and calling it a day.

Volcano makes a *best effort* towards mirroring LavaLink's protocols ~~which was actually very difficult to do granted not much info is out there regarding specific cases of LavaLink's protocols~~ while trying to efficiently memory manage and make use of a thread pool based on worker_threads for reliable and smooth playback.

# Some Caveats
Volcano only supports YouTube, Soundcloud, and http currently. Any other sources will not work. If you really want them to work with Volcano, please open a PR. I am more than happy to add features.

# Performance
Test Machine: 4 VCores, 8GB VALLOC memory, 200GB SSD. Running Ubuntu 20.04.2 LTS. Provided by Contabo, located in Saint Louis, Missouri.

All tests with LavaLink were conducted with Java 14 LTS (openjdk-14-jre-headless).
All tests with Volcano were conducted with Node JS 14.17.0
## Boot
LavaLink using Java 14 LTS (openjdk-14-jre-headless) took approximately 3 seconds to reach a post ready state.
Volcano using Node JS 14.17.0 took 0.37 seconds to reach a post ready state.

## Memory usage
LavaLink:
	idle occupied 162MB stable.
Volcano:
	idle occupied 15.3MB stable (0.7MB in Volcano's allocated space. 14.6 from Node JS's runtime).

## Networking
I don't have a consistent way to measure networking in either scenario, however, I can describe that while getting tracks from any source, only essential data is fetched in the form of streams. This keeps possible bandwidth waste low and memory usage lower. Currently in Volcano while getting track info from the HTTP source, only 20 chunks of 16KB (320KB total) are allowed to be piped. After that, the stream is forcibly closed and the HTTP connection is destroyed. This limit is more than sufficient to allow for the stream to have key metadata properties identified such as track duration and possible author/track name in some encodings which support metadata embedding such as opus.

No assumptions are made in regards to track metadata including streams.

## CPU usage
tested tracks are all the same across all tests. (O:https://api-v2.soundcloud.com/media/soundcloud:tracks:401256987/1593d9da-25e1-4bdb-9449-6faad4616d52/stream/hls)
LavaLink:
	1 player
	3 players
Volcano:
	1 player
	3 players
