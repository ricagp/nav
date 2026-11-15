#ifndef IUPDATABLE_H
#define IUPDATABLE_H

class IUpdatable {
public:
    virtual ~IUpdatable() = default;

    // Cambiado de void a bool
    virtual bool begin() = 0;
    virtual void update() = 0;
};

#endif