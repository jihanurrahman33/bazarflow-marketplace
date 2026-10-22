/** Catalogue skeleton for the bulk demo seed: 30 categories, each served by one store. Demo data only. */
export interface BulkCategory { slug: string; name: string; store: { name: string; slug: string; owner: string; city: string; blurb: string } }

export const BULK_CATEGORIES: BulkCategory[] = [
  { slug: "mobiles-tablets", name: "Mobiles & Tablets", store: { name: "Gadget Gali", slug: "gadget-gali", owner: "Arif Hossain", city: "Dhaka", blurb: "Phones, tablets and accessories from trusted brands." } },
  { slug: "laptops-computers", name: "Laptops & Computers", store: { name: "Byte Bazar", slug: "byte-bazar", owner: "Nafis Rahman", city: "Dhaka", blurb: "Laptops, monitors and PC parts for work and play." } },
  { slug: "cameras-photography", name: "Cameras & Photography", store: { name: "Lens Lane", slug: "lens-lane", owner: "Shamim Reza", city: "Chattogram", blurb: "Cameras, lenses and tripods for every kind of shooter." } },
  { slug: "audio-headphones", name: "Audio & Headphones", store: { name: "Sound Shed", slug: "sound-shed", owner: "Mehedi Hasan", city: "Dhaka", blurb: "Headphones, speakers and everything for better sound." } },
  { slug: "wearables", name: "Wearables", store: { name: "Wrist Works", slug: "wrist-works", owner: "Tasnim Akter", city: "Dhaka", blurb: "Smart bands and watches for everyday tracking." } },
  { slug: "gaming", name: "Gaming", store: { name: "Level Up Store", slug: "level-up-store", owner: "Rakib Chowdhury", city: "Dhaka", blurb: "Controllers, headsets and gear for gamers." } },
  { slug: "home-appliances", name: "Home Appliances", store: { name: "Ghar Electric", slug: "ghar-electric", owner: "Jahid Karim", city: "Khulna", blurb: "Reliable appliances for a busy home." } },
  { slug: "kitchen-dining", name: "Kitchen & Dining", store: { name: "Rannaghor", slug: "rannaghor", owner: "Salma Khatun", city: "Sylhet", blurb: "Cookware and tableware for everyday meals." } },
  { slug: "furniture", name: "Furniture", store: { name: "Kathmistri Co.", slug: "kathmistri-co", owner: "Abdul Malek", city: "Dhaka", blurb: "Solid, well-finished furniture for every room." } },
  { slug: "bedding-bath", name: "Bedding & Bath", store: { name: "Sukhnidra", slug: "sukhnidra", owner: "Nasrin Sultana", city: "Rajshahi", blurb: "Soft linens and towels for better rest." } },
  { slug: "home-decor", name: "Home Decor", store: { name: "Sajano Ghor", slug: "sajano-ghor", owner: "Moushumi Haque", city: "Dhaka", blurb: "Decor pieces that make a house feel like home." } },
  { slug: "lighting", name: "Lighting", store: { name: "Alo Ghar", slug: "alo-ghar", owner: "Kamal Uddin", city: "Dhaka", blurb: "Lamps and lighting for every corner." } },
  { slug: "garden-outdoor", name: "Garden & Outdoor", store: { name: "Bagan Bari", slug: "bagan-bari", owner: "Hasan Mahmud", city: "Rangpur", blurb: "Planters, tools and outdoor living." } },
  { slug: "tools-hardware", name: "Tools & Hardware", store: { name: "Toolbox BD", slug: "toolbox-bd", owner: "Shafiqul Islam", city: "Chattogram", blurb: "Hand tools and hardware for fixers and builders." } },
  { slug: "mens-clothing", name: "Men's Clothing", store: { name: "Purush Wardrobe", slug: "purush-wardrobe", owner: "Anis Ahmed", city: "Dhaka", blurb: "Shirts, tees and trousers cut for the climate." } },
  { slug: "womens-clothing", name: "Women's Clothing", store: { name: "Nari Fashion House", slug: "nari-fashion-house", owner: "Farzana Yeasmin", city: "Dhaka", blurb: "Everyday and occasion wear from local designers." } },
  { slug: "kids-baby", name: "Kids & Baby", store: { name: "Chotto Bondhu", slug: "chotto-bondhu", owner: "Shirin Akhter", city: "Dhaka", blurb: "Clothing and essentials for little ones." } },
  { slug: "footwear", name: "Footwear", store: { name: "Pa Pa Shoes", slug: "pa-pa-shoes", owner: "Munna Mia", city: "Dhaka", blurb: "Sneakers, sandals and formal shoes." } },
  { slug: "bags-luggage", name: "Bags & Luggage", store: { name: "Jhola Junction", slug: "jhola-junction", owner: "Rubel Hossain", city: "Dhaka", blurb: "Backpacks, totes and travel bags." } },
  { slug: "watches-jewellery", name: "Watches & Jewellery", store: { name: "Shonar Dokan", slug: "shonar-dokan", owner: "Pulak Das", city: "Dhaka", blurb: "Watches and jewellery for gifting and daily wear." } },
  { slug: "beauty-skincare", name: "Beauty & Skincare", store: { name: "Rup Chorcha", slug: "rup-chorcha", owner: "Lamia Tabassum", city: "Dhaka", blurb: "Skincare and beauty essentials." } },
  { slug: "health-wellness", name: "Health & Wellness", store: { name: "Shushtho Jibon", slug: "shushtho-jibon", owner: "Dr. Imtiaz Alam", city: "Dhaka", blurb: "Everyday wellness and personal care." } },
  { slug: "sports-fitness", name: "Sports & Fitness", store: { name: "Fit Fiesta", slug: "fit-fiesta", owner: "Sohel Rana", city: "Dhaka", blurb: "Gear for training, running and play." } },
  { slug: "books-stationery", name: "Books & Stationery", store: { name: "Boi Ghor", slug: "boi-ghor", owner: "Anwar Kabir", city: "Dhaka", blurb: "Notebooks, pens and reading for every desk." } },
  { slug: "toys-games", name: "Toys & Games", store: { name: "Khelna Mela", slug: "khelna-mela", owner: "Ritu Parvin", city: "Dhaka", blurb: "Toys and games for all ages." } },
  { slug: "pet-supplies", name: "Pet Supplies", store: { name: "Pet Pal BD", slug: "pet-pal-bd", owner: "Tanjila Ferdous", city: "Dhaka", blurb: "Food, toys and care for cats and dogs." } },
  { slug: "automotive", name: "Automotive", store: { name: "Gari Care", slug: "gari-care", owner: "Mizanur Rahman", city: "Dhaka", blurb: "Car and bike care, accessories and spares." } },
  { slug: "bikes-scooters", name: "Bikes & Scooters", store: { name: "Cycle Corner", slug: "cycle-corner", owner: "Nurul Amin", city: "Dhaka", blurb: "Bicycles, helmets and riding accessories." } },
  { slug: "musical-instruments", name: "Musical Instruments", store: { name: "Sur Sangeet", slug: "sur-sangeet", owner: "Prodip Roy", city: "Dhaka", blurb: "Guitars, keyboards and accessories for musicians." } },
  { slug: "art-craft", name: "Art & Craft", store: { name: "Rongtuli", slug: "rongtuli", owner: "Sumaiya Binte Alam", city: "Dhaka", blurb: "Paints, brushes and craft supplies." } },
];

export const BULK_CUSTOMERS = [
  "Rahim Sheikh", "Nusrat Kabir", "Tanvir Alam", "Sadia Rahman", "Imran Mollah", "Farhana Haque", "Jubayer Ahmed", "Mitu Akter",
  "Shahriar Khan", "Lipi Begum", "Asif Mahmud", "Tania Sultana", "Riyad Hossain", "Sharmin Nahar", "Fahim Chowdhury", "Mim Islam",
  "Zubair Ahmed", "Nodi Rahman", "Habib Ullah", "Priya Das", "Shakil Mia", "Rima Khatun", "Kabir Hasan", "Sumi Akter",
  "Mahin Reza", "Tuli Sarkar", "Sazzad Hossain", "Ayesha Siddika", "Rafi Uddin", "Keya Paul", "Nabil Karim", "Poly Akter",
  "Emon Biswas", "Joya Sen", "Masud Rana", "Dilruba Yasmin", "Limon Sarder", "Bithi Rani", "Rony Ahmed", "Shuvo Dey",
];
