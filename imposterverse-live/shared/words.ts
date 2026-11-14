// The secret-word database. ~600 words across 11 categories.

export interface Category {
  id: string;
  name: string;
  words: string[];
}

const c = (id: string, name: string, list: string): Category => ({
  id,
  name,
  words: list.split(',').map((w) => w.trim()).filter(Boolean),
});

export const CATEGORIES: Category[] = [
  c('food', 'Food',
    'Pizza,Sushi,Biryani,Pancakes,Tacos,Lasagna,Dumplings,Croissant,Burger,Ramen,Paella,Curry,Popcorn,Chocolate,Ice Cream,Omelette,Samosa,Noodles,Cheesecake,Waffles,Hot Dog,Salad,Sandwich,Doughnut,Pretzel,Spaghetti,Risotto,Falafel,Hummus,Kebab,Fried Rice,Steak,Lobster,Cupcake,Brownie,Yoghurt,Honey,Pickle,Butter Chicken,Dosa,Guacamole,Burrito,Fondue,Macaron,Tiramisu,Porridge,Meatballs,French Fries,Garlic Bread,Milkshake,Mango,Pineapple,Coconut,Avocado,Watermelon'),
  c('animals', 'Animals',
    'Elephant,Penguin,Giraffe,Kangaroo,Dolphin,Octopus,Tiger,Peacock,Owl,Chameleon,Hedgehog,Flamingo,Panda,Koala,Sloth,Camel,Zebra,Rhinoceros,Hippopotamus,Crocodile,Cheetah,Gorilla,Wolf,Fox,Bat,Eagle,Parrot,Swan,Shark,Whale,Jellyfish,Seahorse,Crab,Turtle,Frog,Snail,Butterfly,Honeybee,Ant,Spider,Scorpion,Squirrel,Rabbit,Hamster,Horse,Donkey,Goat,Rooster,Otter,Walrus,Polar Bear,Meerkat,Raccoon,Lizard,Cobra'),
  c('countries', 'Countries',
    'India,Japan,Brazil,Egypt,Canada,Italy,Australia,Mexico,France,Kenya,Norway,Thailand,Argentina,Greece,Iceland,Turkey,Spain,Germany,China,Russia,South Africa,Nigeria,Morocco,Peru,Chile,Cuba,Portugal,Ireland,Switzerland,Netherlands,Sweden,Finland,Poland,Vietnam,Indonesia,Nepal,Sri Lanka,Singapore,South Korea,New Zealand,Saudi Arabia,United Kingdom,United States,Jamaica,Colombia,Austria,Belgium,Denmark,Bhutan,Mongolia,Madagascar,Philippines,Malaysia,Ethiopia,Fiji'),
  c('cities', 'Cities',
    'Paris,Tokyo,New York,Mumbai,London,Dubai,Rome,Sydney,Cairo,Venice,Las Vegas,Istanbul,Barcelona,Amsterdam,Singapore,Hong Kong,Rio de Janeiro,Moscow,Berlin,Bangkok,Delhi,Jaipur,Varanasi,Kolkata,Bengaluru,Hyderabad,Los Angeles,San Francisco,Chicago,Toronto,Mexico City,Buenos Aires,Cape Town,Marrakech,Athens,Vienna,Prague,Lisbon,Dublin,Edinburgh,Seoul,Beijing,Shanghai,Kyoto,Kathmandu,Jerusalem,Florence,Monaco,Havana,Reykjavik,Zurich,Milan,Miami,Seattle,Goa'),
  c('movies', 'Movies',
    'Titanic,Inception,Jurassic Park,The Lion King,Avatar,Frozen,The Matrix,Jaws,Finding Nemo,Gladiator,Star Wars,Harry Potter,The Godfather,Toy Story,Interstellar,Shrek,Rocky,Home Alone,Casablanca,Spider-Man,Batman,The Avengers,Black Panther,Up,Coco,Moana,Aladdin,Cinderella,King Kong,Godzilla,Ghostbusters,Back to the Future,Forrest Gump,The Terminator,Mission Impossible,James Bond,Pirates of the Caribbean,The Lord of the Rings,Kung Fu Panda,Ratatouille,Wall-E,Inside Out,Life of Pi,Slumdog Millionaire,3 Idiots,Dangal,Lagaan,Sholay,Baahubali,RRR,Parasite,Joker,La La Land,Top Gun,Barbie'),
  c('sports', 'Sports',
    'Cricket,Football,Basketball,Tennis,Badminton,Swimming,Boxing,Golf,Hockey,Chess,Kabaddi,Surfing,Archery,Wrestling,Cycling,Rugby,Baseball,Volleyball,Table Tennis,Marathon,Gymnastics,Fencing,Skiing,Snowboarding,Ice Skating,Karate,Judo,Weightlifting,Rowing,Sailing,Polo,Squash,Bowling,Darts,Snooker,Skateboarding,Rock Climbing,Diving,High Jump,Javelin,Formula One,Horse Racing,Handball,Water Polo,Curling,Triathlon,Kho Kho,Carrom,Arm Wrestling,Tug of War,Dodgeball,Paragliding,Bungee Jumping,Yoga,Sumo'),
  c('technology', 'Technology',
    'Smartphone,Laptop,Robot,Drone,Bluetooth,Satellite,Password,Wi-Fi,Keyboard,Headphones,Camera,Battery,Podcast,Emoji,Search Engine,Selfie,Touchscreen,Smartwatch,Virtual Reality,3D Printer,Electric Car,Microchip,Cloud Storage,Website,Email,Video Call,Streaming,Hashtag,QR Code,GPS,USB Drive,Charger,Router,Webcam,Microphone,Projector,Game Console,Calculator,Printer,Television,Remote Control,Solar Panel,Rocket,Telescope,Microscope,Hologram,Chatbot,Algorithm,Firewall,Screenshot,Download,Notification,Autocorrect,Dark Mode,App Store'),
  c('objects', 'Everyday Objects',
    'Umbrella,Toothbrush,Mirror,Pillow,Candle,Scissors,Backpack,Clock,Ladder,Wallet,Spoon,Key,Blanket,Kettle,Sunglasses,Chair,Stapler,Zipper,Doorbell,Bucket,Broom,Towel,Soap,Comb,Hanger,Curtain,Carpet,Lamp,Matchbox,Envelope,Notebook,Pencil,Eraser,Ruler,Glue,Tape,Padlock,Hammer,Screwdriver,Nail,Rope,Bottle,Mug,Plate,Fork,Frying Pan,Fridge,Washing Machine,Iron,Fan,Suitcase,Helmet,Shoelace,Belt,Button'),
  c('professions', 'Professions',
    'Doctor,Pilot,Chef,Teacher,Firefighter,Detective,Astronaut,Farmer,Dentist,Lawyer,Photographer,Plumber,Magician,Architect,Journalist,Lifeguard,Nurse,Surgeon,Engineer,Scientist,Electrician,Carpenter,Tailor,Barber,Baker,Butcher,Fisherman,Sailor,Soldier,Police Officer,Judge,Politician,Actor,Singer,Dancer,Painter,Sculptor,Author,Librarian,Accountant,Banker,Cashier,Waiter,Taxi Driver,Postman,Mechanic,Vet,Zookeeper,Beekeeper,Florist,Referee,Clown,Stuntman,Translator,Programmer'),
  c('places', 'Famous Places',
    'Taj Mahal,Eiffel Tower,Great Wall of China,Pyramids of Giza,Statue of Liberty,Colosseum,Machu Picchu,Grand Canyon,Big Ben,Mount Everest,Niagara Falls,Stonehenge,Burj Khalifa,Golden Gate Bridge,Sydney Opera House,Leaning Tower of Pisa,Christ the Redeemer,Petra,Angkor Wat,Acropolis,Louvre,Buckingham Palace,Times Square,Hollywood Sign,Mount Rushmore,Disneyland,Amazon Rainforest,Sahara Desert,Great Barrier Reef,Dead Sea,Mount Fuji,Victoria Falls,Red Square,Vatican,Sagrada Familia,Tower Bridge,Empire State Building,White House,Kremlin,Forbidden City,Golden Temple,Red Fort,Gateway of India,Hawa Mahal,Qutub Minar,Lotus Temple,Charminar,Area 51,Bermuda Triangle,Loch Ness,Galapagos Islands,Yellowstone,Santorini,Alcatraz,North Pole'),
  c('general', 'General Knowledge',
    'Gravity,Rainbow,Volcano,Earthquake,Eclipse,Democracy,Olympics,Dinosaur,Internet,Electricity,Moon Landing,Passport,Museum,Library,Compass,Thunderstorm,Wedding,Birthday,Graduation,Election,Traffic Jam,Airport,Hospital,Supermarket,Circus,Zoo,Aquarium,Lighthouse,Castle,Pyramid,Treasure,Pirate,Ghost,Vampire,Dragon,Unicorn,Mermaid,Superhero,Time Machine,Black Hole,Northern Lights,Tsunami,Desert,Glacier,Jungle,Fossil,Diamond,Gold,Oxygen,Vaccine,Alphabet,Calendar,Lottery,Auction,Magic Trick'),
];

export const categoryName = (id: string | null | undefined): string =>
  CATEGORIES.find((cat) => cat.id === id)?.name ?? 'Random';

export const TOTAL_WORDS = CATEGORIES.reduce((n, cat) => n + cat.words.length, 0);
